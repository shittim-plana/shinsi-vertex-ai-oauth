export type GallerySelectable = { url: string; weight?: number; tags?: string[] };

function normalizeEmotionAlias(raw: string): string {
  const s = (raw || '').toString().trim().toLowerCase();
  if (!s) return '';
  const map: Record<string, string> = {
    // neutral
    neutral: 'neutral',
    none: 'neutral',
    netural: 'neutral',
    '기본': 'neutral',
    '중립': 'neutral',
    // happy cluster
    happy: 'happy',
    smile: 'happy',
    enjoy: 'happy',
    laugh: 'happy',
    delight: 'happy',
    joy: 'happy',
    '웃음': 'happy',
    '웃': 'happy',
    '미소': 'happy',
    '즐거움': 'happy',
    '즐겁': 'happy',
    '행복': 'happy',
    '해피': 'happy',
    '기쁨': 'happy',
    '설렘': 'happy',
    // sad cluster
    sad: 'sad',
    cry: 'sad',
    tears: 'sad',
    depress: 'sad',
    depressed: 'sad',
    disappointed: 'sad',
    '울음': 'sad',
    '슬픔': 'sad',
    '슬프': 'sad',
    '눈물': 'sad',
    '우울': 'sad',
    '실망': 'sad',
    '서러': 'sad',
    '침울': 'sad',
    '다운': 'sad',
    // anger cluster
    anger: 'anger',
    angry: 'anger',
    mad: 'anger',
    rage: 'anger',
    furious: 'anger',
    '분노': 'anger',
    '화남': 'anger',
    '화가': 'anger',
    '짜증': 'anger',
    '빡침': 'anger',
    '열받': 'anger',
    '성남': 'anger',
    '화났': 'anger',
    '앙리': 'anger',
    // love cluster
    love: 'love',
    heart: 'love',
    romance: 'love',
    affection: 'love',
    crush: 'love',
    '사랑': 'love',
    '사랑해': 'love',
    '연애': 'love',
    '연인': 'love',
    '연모': 'love',
    '하트': 'love',
    // embarrassed cluster
    embarrassed: 'embarrassed',
    shy: 'embarrassed',
    '당황': 'embarrassed',
    '부끄': 'embarrassed',
    '창피': 'embarrassed',
    '수줍': 'embarrassed',
    '수줍음': 'embarrassed',
    // thinking cluster
    thinking: 'thinking',
    ponder: 'thinking',
    '생각': 'thinking',
    '고민': 'thinking',
  };
  return map[s] || s;
}

// Deterministic pseudo-random number generator in [0, 1) based on a string seed
function seededUnitRandom(seedKey: string): number {
  let h = 2166136261 >>> 0; // FNV-1a base
  for (let i = 0; i < seedKey.length; i++) {
    h ^= seedKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Additional mixing (avalanche)
  h += h << 13; h ^= h >>> 7; h += h << 3; h ^= h >>> 17; h += h << 5;
  return ((h >>> 0) / 4294967296);
}

function buildTagKeySet(tags?: string[]): Set<string> {
  const set = new Set<string>();
  if (!Array.isArray(tags)) return set;
  for (const t of tags) {
    const n = (t ?? '').toString().trim().toLowerCase();
    if (!n) continue;
    set.add(n);
    set.add(normalizeEmotionAlias(n));
  }
  return set;
}
/**
 * Resolve a coarse emotion string from free text using simple keyword heuristics.
 * If multiple categories match, priority order is: anger > sad > love > happy.
 * 한국어 동의어를 확장해 매칭률을 높입니다.
 */
export function resolveEmotionFromText(text?: string, allowed?: string[]): string | undefined {
  if (!text) return undefined;

  // 0) 우선 규칙: "- Tag: ${...}" 라인 내부를 세그먼트 단위로 해석
  const explicit = text.match(/^\s*-?\s*(?:Tag|Emotion):\s*([^\n\r]+)/im);
  if (explicit) {
    const rawLine = explicit[1].trim().replace(/^['"]|['"]$/g, '');

    // 허용 목록(있을 경우) 준비
    const allowedList = Array.isArray(allowed)
      ? Array.from(new Set(allowed.map(s => String(s ?? '').trim()).filter(Boolean)))
      : [];
    const allowedSet = new Set(allowedList);

    // 간단 별칭 매핑 (영→KO)
    const aliasMap: Record<string, string> = {
      happy: '행복',
      joy: '행복',
      sad: '슬픔',
      sadness: '슬픔',
      angry: '분노',
      anger: '분노',
      surprise: '놀람',
      surprised: '놀람',
      fear: '공포',
      scared: '공포',
      love: '사랑',
      neutral: '중립',
    };

    // 정규화 유틸
    const normLower = (s: string): string =>
      String(s ?? '')
        .toLocaleLowerCase()
        .replace(/^[\s"'“”‘’()[\]{}<>•\-–—]+|[\s"'“”‘’()[\]{}<>•\-–—]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const stripParens = (s: string): string => String(s).replace(/\([^)]*\)/g, ' ').trim();

    // B/C 시도: 괄호 라벨 → 세그먼트 본문 토큰
    const tryParenAndTokens = (scope: string): string | undefined => {
      // B) 괄호 라벨
      const parenMatches = Array.from(String(scope).matchAll(/\(([^)]+)\)/g)).map(m => m[1]);
      for (const p of parenMatches) {
        const parts = String(p).split(/[\/|,]| - |–|-|•/g).map(x => x.trim()).filter(Boolean);
        for (const part of parts) {
          if (/^none$/i.test(part)) return allowedSet.size > 0 ? 'none' : 'neutral';
          if (allowedSet.size > 0) {
            if (allowedSet.has(part)) return part;
            const aliasKO = aliasMap[normLower(part)];
            if (aliasKO && allowedSet.has(aliasKO)) return aliasKO;
          } else {
            const aliasKO = aliasMap[normLower(part)];
            if (aliasKO) return aliasKO; // KO 라벨 그대로
            const canon = normalizeEmotionAlias(part);
            if (canon) return canon;     // 영문 클러스터 규칙
          }
        }
      }

      // C) 세그먼트 텍스트 토큰 스캔(괄호 제거 후)
      const noParen = stripParens(scope);
      const tokens = String(noParen).split(/[\/|,]| - |–|-|•|\s+/g).map(x => x.trim()).filter(Boolean);
      for (const t of tokens) {
        if (/^none$/i.test(t)) return allowedSet.size > 0 ? 'none' : 'neutral';
        if (allowedSet.size > 0) {
          if (allowedSet.has(t)) return t;
          const aliasKO = aliasMap[normLower(t)];
          if (aliasKO && allowedSet.has(aliasKO)) return aliasKO;
        } else {
          const aliasKO = aliasMap[normLower(t)];
          if (aliasKO) return aliasKO;
          const canon = normalizeEmotionAlias(t);
          if (canon) return canon;
        }
      }
      return undefined;
    };

    // 1) 쉼표 기준 세그먼트 분할 후 좌→우 우선 처리
    const segments = rawLine.split(/,|，/g).map(s => s.trim()).filter(Boolean);
    for (const seg of segments) {
      // A) 숫자 인덱스 매핑 (allowed 있을 때만)
      if (allowedList.length > 0) {
        const nm = seg.match(/\b(\d{1,2})\b/);
        if (nm) {
          const n = parseInt(nm[1], 10);
          if (Number.isFinite(n) && n >= 1 && n <= allowedList.length) {
            const label = allowedList[n - 1];
            if (label) return label;
          }
        }
      }
      // B → C
      const hit = tryParenAndTokens(seg);
      if (hit) return hit;
    }

    // 2) 세그먼트 실패 시, 라인 전체에 대해 B → C 재시도
    const globalHit = tryParenAndTokens(rawLine);
    if (globalHit) return globalHit;

    // 3) 레거시 폴백 (기존 동작 유지)
    const lowerLine = rawLine.toLowerCase();
    const known = new Set(['neutral', 'happy', 'sad', 'anger', 'love', 'embarrassed', 'thinking']);
    const candidates: string[] = [];
    candidates.push(lowerLine);
    const parenInner = Array.from(lowerLine.matchAll(/\(([^)]+)\)/g)).map(m => m[1]);
    candidates.push(...parenInner);
    const tokensLegacy = lowerLine.split(/[\s,;\/|()]+/).filter(Boolean);
    candidates.push(...tokensLegacy);
    for (const c of candidates) {
      const canon = normalizeEmotionAlias(c);
      if (known.has(canon)) return canon;
    }
    const includeMap: Record<string, string[]> = {
      happy: ['happy', 'smile', 'smiley', '웃', '웃음', '미소', '기쁨', '행복', '즐거움', 'enjoy', 'laugh', 'delight', 'joy', '해피'],
      sad: ['sad', 'cry', 'tears', '눈물', '슬픔', '우울', '실망', 'disappointed', 'depress', 'depressed', '서러', '슬프', '침울', '다운'],
      anger: ['anger', 'angry', 'mad', 'rage', '분노', '화', '화남', '화가', '짜증', '빡침', '열받', '성남', '화났', '앙리', 'furious'],
      love: ['love', 'heart', 'romance', '사랑', '연애', '하트', '연인', '연모', 'affection', 'crush'],
      neutral: ['neutral', 'none', 'default', 'basic', '기본', '중립', 'netural'],
      embarrassed: ['embarrassed', '당황', '부끄', '창피', 'shy'],
      thinking: ['thinking', '생각', 'ponder'],
    };
    for (const [emo, keys] of Object.entries(includeMap)) {
      if (keys.some(k => lowerLine.includes(k))) {
        return emo;
      }
    }
    return undefined;
  }

  // 1) 폴백 규칙: 자유 텍스트 휴리스틱
  const lower = text.toLowerCase();
  const buckets: Record<string, string[]> = {
    anger: ['분노', '화남', '열받', '화가', '짜증', '성남', '빡침', '화났', '앙리', 'anger', 'angry', 'furious', 'rage', 'mad'],
    sad: ['슬픔', '우울', '눈물', '서러', '슬프', '침울', '다운', 'sad', 'cry', 'depress'],
    love: ['사랑', '연애', '연인', '사랑해', '연모', '하트', 'love', 'heart', 'romance', 'affection', 'crush'],
    happy: ['행복', '기쁨', '웃음', '즐겁', '신남', '설렘', '미소', '해피', 'happy', 'smile', 'delight', 'joy'],
    '분노': ['분노', '화남', '열받', '화가', '짜증', '성남', '빡침', '화났', '앙리', 'anger', 'angry', 'furious', 'rage', 'mad'],
    '슬픔': ['슬픔', '우울', '눈물', '서러', '슬프', '침울', '다운', 'sad', 'cry', 'depress'],
    '사랑': ['사랑', '연애', '연인', '사랑해', '연모', '하트', 'love', 'heart', 'romance', 'affection', 'crush'],
    '행복': ['행복', '기쁨', '웃음', '즐겁', '신남', '설렘', '미소', '해피', 'happy', 'smile', 'delight', 'joy'],
  };

  const matched: string[] = [];
  for (const [emo, keys] of Object.entries(buckets)) {
    if (keys.some(k => lower.includes(k))) matched.push(emo);
  }
  if (matched.length === 0) return undefined;
  const priority = ['anger', 'sad', 'love', 'happy'];
  for (const p of priority) {
    if (matched.includes(p)) return p;
  }
  console.warn('resolveEmotionFromText: unexpected match order', { text, matched });
  return matched[0];
}

/**
 * 내부 유틸: URL/파일명에 감정 키워드가 있는지 검사
 */
function inferEmotionFromFilename(url?: string): string | undefined {
  if (!url) return undefined;
  const name = url.toLowerCase();
  const map: Record<string, string[]> = {
    happy: ['happy', 'smile', 'smiley', '웃', '웃음', '미소', '기쁨', '행복', '즐거움', 'enjoy', 'laugh'],
    sad: ['sad', 'cry', 'tears', '눈물', '슬픔', '우울', '실망', 'disappointed', 'depress', 'depressed'],
    anger: ['anger', 'angry', 'mad', 'rage', '분노', '화', '화남', '화가', '짜증', '빡침'],
    love: ['love', 'heart', 'romance', '사랑', '연애', '하트'],
    neutral: ['neutral', 'default', 'basic', '기본', '중립', 'netural'],
    embarrassed: ['embarrassed', '당황', '부끄', '창피', 'shy'],
    thinking: ['thinking', '생각', 'ponder'],
    '행복': ['happy', 'smile', 'smiley', '웃', '웃음', '미소', '기쁨', '행복', '즐거움', 'enjoy', 'laugh'],
    '슬픔': ['sad', 'cry', 'tears', '눈물', '슬픔', '우울', '실망', 'disappointed', 'depress', 'depressed'],
    '분노': ['anger', 'angry', 'mad', 'rage', '분노', '화', '화남', '화가', '짜증', '빡침'],
    '사랑': ['love', 'heart', 'romance', '사랑', '연애', '하트'],
    '중립': ['neutral', 'default', 'basic', '기본', '중립', 'netural'],
    '당황': ['embarrassed', '당황', '부끄', '창피', 'shy'],
    '생각': ['thinking', '생각', 'ponder'],
  };
  for (const [emo, keys] of Object.entries(map)) {
    if (keys.some(k => name.includes(k))) return emo;
  }
  return undefined;
}

/**
 * Weighted random pick among candidates that optionally match an emotion tag.
 * 보강: 태그 매칭 실패 시 파일명 키워드로 보조 매칭을 수행합니다.
 */
export function selectGalleryImageByEmotion(
  emotion: string | undefined,
  items: GallerySelectable[],
  seed?: string,
): string | undefined {
  if (!Array.isArray(items) || items.length === 0) return undefined;

  const norm = (s: string) => s.trim().toLowerCase();
  const emo = emotion ? normalizeEmotionAlias(norm(emotion)) : undefined;

  const hasTag = (tags?: string[], tag?: string) => {
    if (!tag || !Array.isArray(tags)) return false;
    const set = buildTagKeySet(tags);
    const key = normalizeEmotionAlias(norm(tag));
    return set.has(key);
  };

  // 0) 유효 URL만 후보
  const candidates = items.filter(it => typeof it.url === 'string' && !!it.url);

  // 1) 감정이 없는 경우: 'neutral' 태그가 있는 항목을 우선 시도
  if (!emo) {
    const neutralPool = candidates.filter(it => hasTag(it.tags, 'neutral'));
    if (neutralPool.length > 0) {
      const weightedNeutral = neutralPool
        .map(it => ({ ...it, _w: Math.max(0, typeof it.weight === 'number' ? it.weight : 1) }))
        .filter(it => it._w > 0);
      if (weightedNeutral.length > 0) {
        const totalNeutral = weightedNeutral.reduce((s, it) => s + it._w, 0);
        const rSeed = (seed || '') + ':neutral';
        let r = seededUnitRandom(rSeed) * totalNeutral;
        for (const it of weightedNeutral) {
          r -= it._w;
          if (r <= 0) return it.url;
        }
        return weightedNeutral[weightedNeutral.length - 1].url;
      }
      // 가중치가 0이어서 실패하면 neutralPool 첫 항목으로 폴백
      return neutralPool[0]?.url;
    }
    // neutral 없으면 아래 일반 선택 로직으로 폴백
  }

  // 2) 감정 스코어링 기반 후보 선정 (정확 일치 > 별칭 일치 > 파일명 키워드 > 태그 부분일치 > URL 부분일치)
  let pool = candidates;
  if (emo) {
    type Scored = GallerySelectable & { _score: number };
    const scored: Scored[] = candidates.map(it => {
      const tset = buildTagKeySet(it.tags);
      const tagsLower = Array.isArray(it.tags) ? it.tags.map(norm) : [];
      const literal = tagsLower.includes(emo);             // 태그가 emo를 문자 그대로 포함
      const alias = !literal && tset.has(emo);             // 정규화 별칭으로 일치
      const loose = Array.isArray(it.tags) && it.tags.some(t => {
        const nt = norm(t);
        return nt.includes(emo) || emo.includes(nt);
      });                                                  // 느슨한 부분 일치
      const url = (it.url || '').toLowerCase();
      const file = inferEmotionFromFilename(it.url) === emo; // 파일명 기반 키워드
      const urlSub = url.includes(emo);                      // URL 부분 일치

      let s = 0;
      if (literal) s += 10;
      if (alias) s += 8;
      if (file) s += 6;
      if (loose) s += 4;
      if (urlSub) s += 2;

      return { ...it, _score: s };
    });

    const maxScore = scored.reduce((m, it) => Math.max(m, it._score), 0);
    pool = maxScore > 0 ? scored.filter(it => it._score === maxScore) : candidates;
  }

  // 3) 가중치 룰렛
  const weighted = pool
    .map(it => ({ ...it, _w: Math.max(0, typeof it.weight === 'number' ? it.weight : 1) }))
    .filter(it => it._w > 0);

  if (weighted.length === 0) return pool[0]?.url;

  const total = weighted.reduce((s, it) => s + it._w, 0);
  const rSeed = (seed || '') + ':pool';
  let r = seededUnitRandom(rSeed) * total;
  for (const it of weighted) {
    r -= it._w;
    if (r <= 0) return it.url;
  }
  return weighted[weighted.length - 1].url;
}

/**
 * 캐릭터의 additionalImages에서 감정에 따라 이미지를 선택합니다.
 * 기존: [0: neutral, 1: happy, 2: sad, 3: anger, 4: love]
 * 보강: 배열 순서가 일치하지 않아도 URL/파일명 키워드로 우선 매칭하고,
 *       실패 시 기존 인덱스 규칙을 사용합니다.
 */
export function selectAdditionalImageByEmotion(
  emotion: string | undefined,
  additionalImages: string[],
  seed?: string, // 시그니처 통일을 위한 선택 인자(현재 로직에서는 사용하지 않음)
  options?: { characterTags?: string[] },
): string | undefined {
  if (!Array.isArray(additionalImages) || additionalImages.length === 0) {
    return undefined;
  }

  const eRaw = (emotion ? emotion : 'neutral').toLowerCase().trim();
  const normalizedEmotion = normalizeEmotionAlias(eRaw);

  // 태그/키워드 정규화 유틸
  const normalizeToken = (s: string): string =>
    String(s ?? '')
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^[\s"'“”‘’()[\]{}<>•\-–—]+|[\s"'“”‘’()[\]{}<>•\-–—]+$/g, '')
      .trim();

  // CharacterForm에서 등록된 태그를 검색 키로 활용
  const characterTags = Array.isArray(options?.characterTags) ? options!.characterTags : undefined;
  const tagKeys = (characterTags || []).map(normalizeToken).filter(Boolean);

  // 1) URL/파일명 기반 우선 매칭 (감정)
  const filenameHit = additionalImages.find(u => inferEmotionFromFilename(u) === normalizedEmotion);
  if (filenameHit) return filenameHit;

  // 1-0) 캐릭터 태그 기반 URL 서브스트링 매칭 (간단 구현: 태그 일치 시 우선 반환)
  if (tagKeys.length > 0) {
    const idxTag = additionalImages.findIndex(u => {
      const low = String(u || '').toLowerCase();
      return tagKeys.some(k => k && low.includes(k));
    });
    if (idxTag !== -1) return additionalImages[idxTag];
  }

  // 1-1) 감정 키워드: URL 서브스트링 매칭 (예: excited, sleepy 등)
  const substringHit = additionalImages.find(u => typeof u === 'string' && u.toLowerCase().includes(normalizedEmotion));
  if (substringHit) return substringHit;

  // 2) 기존 인덱스 규칙 (순서: 기본, 행복, 슬픔, 분노, 사랑)
  const emotionIndexMap: Record<string, number> = {
    '중립': 0,
    '행복': 1,
    '슬픔': 2,
    '분노': 3,
    '사랑': 4,
  };
  const idx = emotionIndexMap[normalizedEmotion];

  if (idx !== undefined && additionalImages[idx]) {
    return additionalImages[idx];
  }

  // 3) 그래도 없으면 기본(0)으로 폴백
  return additionalImages[0] || undefined;
}

// Dev-only regex self-test (client)
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  try {
    const samples = [
      "- Tag: 수치심",
      "Tag: 분노",
      "- Emotion: 행복",
      "Emotion: 슬픔",
    ];
    const re = /^\s*-?\s*(?:Tag|Emotion):\s*([^\n\r]+)/im;
    const results = samples.map((s) => {
      const m = s.match(re);
      return { input: s, captured: m ? m[1].trim() : null };
    });
    // eslint-disable-next-line no-console
    console.log("[gallery] regex self-test (client)", results);
  } catch {}
}