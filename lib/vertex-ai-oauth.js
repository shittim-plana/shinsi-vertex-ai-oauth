/**
 * vertex-ai-oauth.js
 *
 * Vertex AI (GCP) OAuth 인증 유틸리티
 *
 * Google Identity Services(GIS) 라이브러리를 사용해 Cloud Platform 스코프의
 * OAuth 액세스 토큰을 발급·저장·자동 갱신하고, Vertex AI Gemini API에
 * SSE 스트리밍 요청을 보내는 모든 핵심 로직을 포함합니다.
 *
 * 브라우저 기본 동작:
 *   - `google.accounts.oauth2` (GIS 스크립트)로 대화형/silent 토큰 발급
 *   - `localStorage`에 토큰 영속화
 *
 * Node.js / 서버 환경 사용법:
 *   `getToken` 콜백을 제공하면 GIS 없이 토큰을 주입할 수 있습니다.
 *   토큰은 인메모리 스토리지에 캐시되며 만료 전 `getToken`이 다시 호출됩니다.
 *
 * 사용 예시 (Node.js / CommonJS):
 *   const { VertexAIOAuth } = require('./lib/vertex-ai-oauth.js');
 *
 *   // ADC(Application Default Credentials) 연동 예시
 *   const { GoogleAuth } = require('google-auth-library');
 *   const gauth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
 *   const auth = new VertexAIOAuth({
 *     projectId: 'my-project',
 *     region:    'us-central1',
 *     model:     'gemini-2.5-flash',
 *     getToken:  async () => {
 *       const client = await gauth.getClient();
 *       const { token } = await client.getAccessToken();
 *       return { accessToken: token, expiresIn: 3600 };
 *     },
 *   });
 *   const text = await auth.collect(contents, systemPrompt, [], null);
 *
 * 사용 예시 (브라우저 CommonJS / require):
 *   const { VertexAIOAuth } = require('./lib/vertex-ai-oauth.js');
 *   const auth = new VertexAIOAuth({ clientId: '...', projectId: '...', region: 'us-central1', model: 'gemini-2.5-flash' });
 *   auth.onStatusChange = (status) => console.log(status);
 *   auth.signIn();
 *
 * 사용 예시 (브라우저 인라인 스크립트):
 *   브라우저 전용, Node.js 없이 GIS + localStorage만 사용하는 경우에는
 *   더 간단한 vertex-ai-oauth.browser.js를 사용하세요.
 *   <script src="lib/vertex-ai-oauth.browser.js"></script>
 *
 * 보안 주의: OAuth 액세스 토큰이 localStorage에 평문 저장됩니다.
 *   XSS 공격에 노출될 수 있으므로 신뢰할 수 없는 서드파티 스크립트와 함께
 *   사용하지 마세요. 토큰 만료(기본 1시간) 후에는 자동으로 사용이 거부됩니다.
 */

// ── 상수 ──────────────────────────────────────────────────────────────────────

/** localStorage에 토큰을 저장할 때 사용하는 키 */
const VERTEX_TOKEN_STORAGE_KEY = 'lumos_vtx_token';

/** Cloud Platform API 접근 범위 */
const VERTEX_OAUTH_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

/** 토큰 만료 5분 전에 자동 갱신을 시작하는 여유 시간(ms) */
const VERTEX_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 자동 갱신 재시도 최소 대기 시간(ms) */
const VERTEX_REFRESH_MIN_WAIT_MS = 10_000;

/** silent 실패 후 재시도 대기 시간(ms) */
const VERTEX_REFRESH_RETRY_MS = 2 * 60 * 1000;

// ── 스토리지 추상화 ───────────────────────────────────────────────────────────

/**
 * 인메모리 스토리지 구현체.
 * localStorage를 사용할 수 없는 Node.js 환경에서 기본값으로 사용됩니다.
 * 프로세스가 재시작되면 토큰이 사라집니다.
 *
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function _createMemoryStorage() {
    const _map = new Map();
    return {
        getItem:    (key) => (_map.has(key) ? _map.get(key) : null),
        setItem:    (key, value) => _map.set(key, String(value)),
        removeItem: (key) => _map.delete(key),
    };
}

/**
 * 환경에 맞는 기본 스토리지를 반환합니다.
 * - 브라우저: localStorage
 * - Node.js / 기타: 인메모리 스토리지
 *
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function }}
 */
function _defaultStorage() {
    try {
        if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
            return localStorage;
        }
    } catch (_) {
        // localStorage 접근 불가 (iframe sandbox 등)
    }
    return _createMemoryStorage();
}

// ── 클래스 ────────────────────────────────────────────────────────────────────

/**
 * VertexAIOAuth
 *
 * Vertex AI OAuth 인증 상태를 캡슐화하는 클래스입니다.
 * 인스턴스 하나가 하나의 GCP 프로젝트/클라이언트 설정을 담당합니다.
 */
class VertexAIOAuth {
    /**
     * @param {object} config - 초기 설정
     * @param {string} [config.clientId]   - GCP OAuth 2.0 Client ID (브라우저 GIS 흐름에 필요)
     * @param {string} [config.projectId]  - GCP 프로젝트 ID
     * @param {string} [config.region]     - Vertex AI 리전 (기본값: 'us-central1')
     * @param {string} [config.model]      - 모델 이름 (기본값: 'gemini-2.5-flash')
     * @param {number} [config.maxTokens]  - 최대 출력 토큰 수 (기본값: 2048)
     * @param {number} [config.temperature]- 생성 온도 (기본값: 0.9)
     * @param {string} [config.storageKey] - 스토리지 키 (기본값: VERTEX_TOKEN_STORAGE_KEY)
     * @param {Function|null} [config.getToken]
     *   `async () => Promise<{accessToken: string, expiresIn?: number}>` 형태의 콜백.
     *   제공하면 GIS 브라우저 흐름 대신 이 함수가 토큰을 반환합니다.
     *   Node.js + google-auth-library ADC, 서비스 계정 키, 테스트 목업 등에 활용하세요.
     * @param {{ getItem: Function, setItem: Function, removeItem: Function }|null} [config.storage]
     *   토큰 영속화에 사용할 스토리지 구현체.
     *   브라우저에서는 기본적으로 localStorage를 사용하고,
     *   Node.js 등 localStorage가 없는 환경에서는 자동으로 인메모리 스토리지로 폴백합니다.
     */
    constructor({
        clientId    = '',
        projectId   = '',
        region      = 'us-central1',
        model       = 'gemini-2.5-flash',
        maxTokens   = 2048,
        temperature = 0.9,
        storageKey  = VERTEX_TOKEN_STORAGE_KEY,
        getToken    = null,
        storage     = null,
    } = {}) {
        this.clientId    = clientId;
        this.projectId   = projectId;
        this.region      = region;
        this.model       = model;
        this.maxTokens   = maxTokens;
        this.temperature = temperature;
        this.storageKey  = storageKey;

        /**
         * 토큰 공급자 콜백. null이면 브라우저 GIS 흐름을 사용합니다.
         * @type {(() => Promise<{accessToken: string, expiresIn?: number}>) | null}
         * @private
         */
        this._getToken = typeof getToken === 'function' ? getToken : null;

        /**
         * 토큰 영속화 스토리지 ({getItem, setItem, removeItem} 인터페이스).
         * 브라우저: localStorage, Node.js: 인메모리.
         * @private
         */
        this._storage = storage || _defaultStorage();

        /** 메모리 내 토큰 상태 */
        this._token = { accessToken: null, expiresAt: 0 };

        /** 자동 갱신 타이머 ID */
        this._refreshTimer = null;

        /**
         * tryAutoSignIn에서 생성된 취소 가능한 타이머 ID 집합.
         * Set을 사용해 O(1) 조회·삭제를 보장합니다.
         * @type {Set<ReturnType<typeof setTimeout>>}
         */
        this._autoSignInTimers = new Set();

        /**
         * 인증 상태가 변경될 때 호출되는 콜백.
         * @type {((status: VertexAuthStatus) => void) | null}
         *
         * 상태 객체 예시:
         *   { connected: true,  minutesLeft: 42 }
         *   { connected: false, minutesLeft: 0  }
         */
        this.onStatusChange = null;

        /**
         * 메시지(알림/오류)를 전달할 때 호출되는 콜백.
         * @type {((message: string, level: 'info'|'error') => void) | null}
         */
        this.onMessage = null;
    }

    // ── 공개 상태 조회 ──────────────────────────────────────────────────────

    /** 토큰이 유효한지 여부를 반환합니다. */
    get isAuthenticated() {
        return !!(this._token.accessToken && this._token.expiresAt > Date.now());
    }

    /** 토큰 만료까지 남은 시간(ms)을 반환합니다. 만료됐거나 없으면 0. */
    get timeToExpireMs() {
        if (!this._token.accessToken) return 0;
        return Math.max(0, this._token.expiresAt - Date.now());
    }

    // ── 토큰 영속화 ────────────────────────────────────────────────────────

    /**
     * 현재 토큰을 스토리지에 저장합니다.
     * 브라우저에서는 localStorage, Node.js에서는 인메모리 스토리지를 사용합니다.
     * @returns {boolean} 저장 성공 여부
     */
    saveToken() {
        try {
            this._storage.setItem(this.storageKey, JSON.stringify({
                accessToken: this._token.accessToken,
                expiresAt:   this._token.expiresAt,
            }));
            return true;
        } catch (err) {
            console.warn('[VertexAIOAuth] Failed to persist token:', err);
            return false;
        }
    }

    /**
     * 스토리지에서 토큰을 복원합니다.
     * 만료된 토큰은 무시됩니다.
     * @returns {boolean} 유효한 토큰을 복원했는지 여부
     */
    loadTokenFromStorage() {
        try {
            const raw = this._storage.getItem(this.storageKey);
            if (!raw) return false;
            const saved = JSON.parse(raw);
            if (
                saved &&
                typeof saved.accessToken === 'string' && saved.accessToken.length > 0 &&
                typeof saved.expiresAt   === 'number' && saved.expiresAt > Date.now()
            ) {
                this._token.accessToken = saved.accessToken;
                this._token.expiresAt   = saved.expiresAt;
                return true;
            }
        } catch (err) {
            console.warn('[VertexAIOAuth] Failed to load token from storage:', err);
        }
        return false;
    }

    /**
     * 스토리지에서 토큰을 삭제합니다.
     */
    clearStoredToken() {
        try {
            this._storage.removeItem(this.storageKey);
        } catch (_) {
            // 무시
        }
    }

    // ── 상태 변경 알림 ─────────────────────────────────────────────────────

    /**
     * 현재 인증 상태를 onStatusChange 콜백에 전달합니다.
     */
    notifyStatus() {
        if (typeof this.onStatusChange !== 'function') return;
        if (this.isAuthenticated) {
            const minutesLeft = Math.round(this.timeToExpireMs / 60000);
            this.onStatusChange({ connected: true, minutesLeft });
        } else {
            this.onStatusChange({ connected: false, minutesLeft: 0 });
        }
    }

    /**
     * onMessage 콜백에 메시지를 전달합니다.
     * @param {string} message
     * @param {'info'|'error'} [level='info']
     */
    _emit(message, level = 'info') {
        if (typeof this.onMessage === 'function') {
            this.onMessage(message, level);
        }
    }

    // ── OAuth 흐름 ─────────────────────────────────────────────────────────

    /**
     * Google Identity Services(GIS)를 사용해 사용자 대화형 로그인을 시작합니다.
     * 팝업 창이 표시되며, 성공 시 토큰이 저장되고 자동 갱신이 스케줄됩니다.
     *
     * @param {object} [options]
     * @param {string} [options.clientId] - 이 호출에서만 사용할 Client ID (생략 시 this.clientId 사용)
     */
    signIn({ clientId } = {}) {
        const cid = clientId || this.clientId;
        if (!cid) {
            this._emit('GCP OAuth Client ID를 먼저 설정하세요', 'error');
            return;
        }
        if (typeof google === 'undefined' || !google?.accounts?.oauth2) {
            this._emit('Google Identity Services 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도하세요.', 'error');
            return;
        }

        const client = google.accounts.oauth2.initTokenClient({
            client_id: cid,
            scope:     VERTEX_OAUTH_SCOPE,
            callback:  (response) => {
                if (response.error) {
                    this._emit('Google 인증 실패: ' + response.error, 'error');
                    this.onStatusChange?.({ connected: false, minutesLeft: 0, error: response.error });
                    return;
                }
                this._applyNewToken(response.access_token, response.expires_in);
                this._emit('Vertex AI 연결 완료 ✅', 'info');
            },
        });
        client.requestAccessToken();
    }

    /**
     * 로그아웃: 토큰을 메모리·스토리지에서 삭제하고 GIS를 통해 토큰을 폐기합니다.
     * 진행 중인 자동 로그인·갱신 타이머도 모두 취소합니다.
     * signOut() 후 tryAutoSignIn()을 다시 호출하기 전까지는 자동 갱신이 재개되지 않습니다.
     */
    signOut() {
        const token = this._token.accessToken;
        this._token.accessToken = null;
        this._token.expiresAt   = 0;

        if (this._refreshTimer) {
            clearTimeout(this._refreshTimer);
            this._refreshTimer = null;
        }

        // tryAutoSignIn의 재시도 타이머 모두 취소 (Set이므로 O(n))
        for (const id of this._autoSignInTimers) clearTimeout(id);
        this._autoSignInTimers.clear();

        this.clearStoredToken();

        if (token && typeof google !== 'undefined' && google?.accounts?.oauth2?.revoke) {
            google.accounts.oauth2.revoke(token, () => {});
        }

        this.notifyStatus();
        this._emit('Google 로그아웃 완료', 'info');
    }

    // ── 자동 갱신 ──────────────────────────────────────────────────────────

    /**
     * 토큰 만료 5분 전에 silent refresh가 실행되도록 타이머를 예약합니다.
     * 이미 예약된 타이머가 있으면 취소하고 재예약합니다.
     */
    scheduleRefresh() {
        if (this._refreshTimer) clearTimeout(this._refreshTimer);

        const msLeft      = this._token.expiresAt - Date.now();
        const refreshAfter = Math.max(msLeft - VERTEX_REFRESH_MARGIN_MS, VERTEX_REFRESH_MIN_WAIT_MS);

        this._refreshTimer = setTimeout(() => {
            this.requestTokenSilently().catch(() => {
                // silent 실패 — 상태 업데이트 후 2분 뒤 재시도
                this.notifyStatus();
                this._refreshTimer = setTimeout(() => {
                    this.requestTokenSilently().catch(() => this.notifyStatus());
                }, VERTEX_REFRESH_RETRY_MS);
            });
        }, refreshAfter);
    }

    /**
     * 사용자 개입 없이 새 액세스 토큰을 요청합니다.
     *
     * - `getToken` 콜백이 있으면(Node.js / 서버): 해당 콜백을 호출합니다.
     * - 없으면(브라우저 GIS): GIS의 prompt:'' 모드를 사용합니다.
     *   Google 세션이 살아 있을 때만 성공합니다.
     *
     * @returns {Promise<void>} 성공 시 resolve, 실패 시 reject(Error)
     */
    requestTokenSilently() {
        // getToken 콜백이 있으면 GIS 없이 토큰을 주입합니다 (Node.js / 서버 환경)
        if (this._getToken) {
            return Promise.resolve()
                .then(() => this._getToken())
                .then(({ accessToken, expiresIn = 3600 }) => {
                    if (!accessToken) throw new Error('getToken returned empty accessToken');
                    this._applyNewToken(accessToken, expiresIn);
                });
        }

        // 브라우저 GIS silent flow
        return new Promise((resolve, reject) => {
            const cid = this.clientId;
            if (!cid || typeof google === 'undefined' || !google?.accounts?.oauth2) {
                reject(new Error('GIS not available'));
                return;
            }

            const client = google.accounts.oauth2.initTokenClient({
                client_id: cid,
                scope:     VERTEX_OAUTH_SCOPE,
                prompt:    '',               // 사용자 개입 없이 기존 Google 세션 재사용
                callback:  (response) => {
                    if (response.error || !response.access_token) {
                        reject(new Error(response.error || 'silent refresh failed'));
                        return;
                    }
                    this._applyNewToken(response.access_token, response.expires_in);
                    resolve();
                },
            });
            client.requestAccessToken();
        });
    }

    /**
     * 페이지 로드(또는 서버 시작) 시 자동 로그인을 시도합니다.
     *
     * 1) 스토리지에 유효한 토큰이 있으면 즉시 복원합니다.
     * 2) 없거나 만료됐으면:
     *    - `getToken` 콜백이 있으면 즉시 호출합니다 (Node.js / 서버).
     *    - 없으면 GIS silent flow를 시도합니다 (브라우저).
     *      GIS 라이브러리가 아직 로드되지 않은 경우 최대 5초간 지수 백오프로 재시도합니다.
     */
    tryAutoSignIn() {
        if (!this.clientId && !this._getToken) return;

        // 1단계: 스토리지 복원 시도
        if (this.loadTokenFromStorage()) {
            this.notifyStatus();
            this.scheduleRefresh();
            return;
        }

        // 2단계-A: getToken 콜백 (Node.js / 서버 환경)
        if (this._getToken) {
            this.requestTokenSilently().catch(() => this.notifyStatus());
            return;
        }

        // 2단계-B: GIS silent flow (라이브러리 비동기 로드 대비 재시도)
        // 타이머 ID를 Set으로 추적하여 signOut() 시 O(1)으로 취소할 수 있도록 합니다.
        const tryAt = (delay) => {
            const id = setTimeout(() => {
                // signOut()으로 인해 이미 취소된 경우 실행하지 않음
                if (!this._autoSignInTimers.has(id)) return;
                this._autoSignInTimers.delete(id);

                if (typeof google !== 'undefined' && google?.accounts?.oauth2) {
                    this.requestTokenSilently().catch(() => this.notifyStatus());
                } else if (delay < 5000) {
                    tryAt(Math.min(delay * 2, 5000));
                }
            }, delay);
            this._autoSignInTimers.add(id);
        };

        tryAt(500);
    }

    // ── Vertex AI API 요청 ─────────────────────────────────────────────────

    /**
     * Vertex AI Gemini 모델에 SSE 스트리밍 요청을 보냅니다.
     * 토큰이 만료된 경우 silent refresh를 자동으로 시도합니다.
     *
     * @param {object[]} contents       - Gemini API contents 배열
     * @param {string}   systemPrompt   - 시스템 프롬프트 (빈 문자열이면 미포함)
     * @param {object[]} safetySettings - Gemini API safetySettings 배열
     * @param {AbortSignal} signal      - fetch AbortSignal
     * @param {object|null} [genConfig] - generationConfig (null이면 기본값 사용)
     * @returns {Promise<Response>} 스트리밍 fetch Response — 호출자가 직접 읽음
     * @throws {Error} 인증 실패 또는 API 오류
     */
    async stream(contents, systemPrompt, safetySettings, signal, genConfig = null) {
        if (!this.isAuthenticated) {
            try {
                await this.requestTokenSilently();
            } catch (_) {
                throw new Error('Vertex AI 인증이 필요합니다. signIn()을 먼저 호출하세요.');
            }
        }

        if (!this.projectId) {
            throw new Error('Vertex AI GCP 프로젝트 ID를 설정해주세요 (this.projectId)');
        }

        const region    = this.region    || 'us-central1';
        const model     = this.model     || 'gemini-2.5-flash';
        const isGlobal  = region === 'global';
        const host      = isGlobal
            ? 'aiplatform.googleapis.com'
            : region + '-aiplatform.googleapis.com';
        const endpoint  =
            'https://' + host + '/v1/projects/' +
            this.projectId + '/locations/' + region +
            '/publishers/google/models/' + model + ':streamGenerateContent?alt=sse';

        // gemma- 및 gemini-3.* (3.1 제외) 계열: thinkingLevel 'HIGH' + maxOutputTokens 65536 기본
        const isHighThinking = model.startsWith('gemma-') ||
            ((model.startsWith('gemini-3.') || model.startsWith('gemini-3-')) && !model.startsWith('gemini-3.1'));

        const body = {
            contents,
            safetySettings,
            generationConfig: genConfig || {
                // thinking 설정 (GeminiProvider.executeGeminiRequest와 동일한 로직):
                //   - gemma- 및 gemini-3.* (3.1 제외): thinkingLevel 'HIGH', maxOutputTokens 65536 기본
                //   - gemini-2.0-flash: thinkingBudget 0 (thinking 비활성화)
                //   - gemini-3.1-*: thinkingConfig 미포함
                //   - 그 외: thinkingBudget -1 (동적 thinking)
                maxOutputTokens: this.maxTokens || (isHighThinking ? 65536 : undefined),
                temperature:     this.temperature || 0.9,
                ...(isHighThinking
                    ? { thinkingConfig: { thinkingLevel: 'HIGH' } }
                    : model === 'gemini-2.0-flash'
                        ? { thinkingConfig: { thinkingBudget: 0 } }
                        : !model.startsWith('gemini-3.1')
                            ? { thinkingConfig: { thinkingBudget: -1 } }
                            : {}),
            },
        };
        if (systemPrompt) {
            body.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        const response = await fetch(endpoint, {
            method:  'POST',
            headers: {
                'Content-Type':  'application/json',
                'Authorization': 'Bearer ' + this._token.accessToken,
            },
            body:   JSON.stringify(body),
            signal,
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error('Vertex AI API error: ' + response.status + ' — ' + errText);
        }

        return response; // 스트리밍 응답 — 호출자가 직접 읽습니다
    }

    /**
     * Vertex AI 스트리밍 응답을 모두 읽어 완성된 텍스트 문자열을 반환합니다.
     *
     * @param {object[]} contents       - Gemini API contents 배열
     * @param {string}   systemPrompt   - 시스템 프롬프트
     * @param {object[]} safetySettings - safetySettings 배열
     * @param {AbortSignal} signal      - fetch AbortSignal
     * @param {object|null} [genConfig] - generationConfig
     * @returns {Promise<string>} 생성된 텍스트 전체
     */
    async collect(contents, systemPrompt, safetySettings, signal, genConfig = null) {
        const response = await this.stream(contents, systemPrompt, safetySettings, signal, genConfig);
        const reader   = response.body.getReader();
        const decoder  = new TextDecoder();
        let buf  = '';
        let full = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop(); // 마지막 불완전 줄은 다음 청크에서 처리
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const d     = JSON.parse(line.slice(6));
                    const parts = d?.candidates?.[0]?.content?.parts;
                    if (Array.isArray(parts)) {
                        for (const p of parts) {
                            if (typeof p?.text === 'string') full += p.text;
                        }
                    }
                } catch (_) {
                    // 불완전한 JSON 청크 무시
                }
            }
        }

        return full;
    }

    // ── 내부 헬퍼 ─────────────────────────────────────────────────────────

    /**
     * 새 액세스 토큰을 내부 상태에 적용하고 저장·자동 갱신을 설정합니다.
     * @param {string} accessToken
     * @param {number} [expiresIn=3600] - 만료까지 남은 초 수
     * @private
     */
    _applyNewToken(accessToken, expiresIn = 3600) {
        this._token.accessToken = accessToken;
        this._token.expiresAt   = Date.now() + expiresIn * 1000;
        this.saveToken();
        this.notifyStatus();
        this.scheduleRefresh();
    }
}

// ── 모듈 내보내기 ─────────────────────────────────────────────────────────────

// ES 모듈 환경
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VertexAIOAuth, VERTEX_TOKEN_STORAGE_KEY, VERTEX_OAUTH_SCOPE, _createMemoryStorage };
} else if (typeof window !== 'undefined') {
    // 브라우저 전역 스크립트 환경
    window.VertexAIOAuth          = VertexAIOAuth;
    window.VERTEX_TOKEN_STORAGE_KEY = VERTEX_TOKEN_STORAGE_KEY;
    window.VERTEX_OAUTH_SCOPE     = VERTEX_OAUTH_SCOPE;
}
