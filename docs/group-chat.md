### **Firebase 기반 그룹 채팅 & 동적 프로필 전환 명세서**

**Ver 3.0**
**작성일:** 2025-09-22
**참고 코드:** `src/app/chat/[roomId]/page.tsx`, `src/app/api/chat/bot-response/route.ts`, `src/components/chat`, `src/types/chat.ts`

#### **1. 개요**
- Next.js 클라이언트와 Firebase를 사용하여 다수 캐릭터가 한 채팅방에서 번갈아 응답하는 그룹 대화와 캐릭터별 프로필 전환 UI를 제공한다.
- 모든 메시지는 Firestore `chatRooms/{roomId}/messages` 서브컬렉션에 저장되며, 캐릭터 메타데이터는 Firestore `characters` 컬렉션을 참조한다.
- 본 명세는 현재 구현된 로직을 문서화하여 향후 기능 확장 및 협업 시 기준으로 활용한다.

#### **2. 시스템 구성**
- **클라이언트 (Next.js, `src/app/chat/[roomId]/page.tsx`):** 채팅방 초기화, 메시지 입력, 그룹 응답 시뮬레이션, UI 렌더링 및 관리 모달을 담당한다.
- **서버 API**
  - `POST /api/chat/bot-response`: 캐릭터별 LLM 응답 생성 및 장기 기억 처리.
  - `POST /api/chat/convert`: 채팅방 타입 전환(그룹 ↔ 개인)을 트랜잭션으로 관리.
  - `POST /api/vector/index-message`: (fire-and-forget) 생성된 메시지를 벡터 인덱싱.
  - `POST /api/generate-image`: 선택적으로 캐릭터 응답 이미지 생성.
- **데이터 소스**
  - Firestore: `chatRooms`, `chatRooms/{roomId}/messages`, `characters`, `users`, `galleries`.
  - Firebase Storage: 채팅방/캐릭터 이미지 저장.
  - Supabase: RAG 결과 및 요약(`runSupaSummarization`, `runHypaRollup`)에 사용.
  - Points 시스템: `POINT_BALANCES_COLLECTION`, `POINT_TRANSACTIONS_COLLECTION`으로 API 호출 비용 관리.

#### **3. 데이터 모델 요약**
- **`chatRooms` 문서**
  - 기본 필드: `name`, `description`, `image`, `creatorId`, `creatorName`, `isGroupChat`, `isNSFW`, `tags`, `members`, `lastMessage`, `lastUpdated`, `lorebookIds`, `lorebookOrderMode`, `ui`(배경/스킨 설정), `autoConvertToPrivate`.
  - 그룹 관련 필드: `characterIds` (전체 참여 캐릭터 ID 배열), `activeCharacterIds` (현재 턴에 참여중인 캐릭터), `nextSpeakerIndex` (다음 발화자 순환 인덱스), `conversionHistory`.
  - 개인방 호환 필드: `characterId` (단일 캐릭터 ID).
  - 포크 관리: `parentRoomId`, `forkPoint`, `isFork`, `forkRoomIds`.
- **`chatRooms/{roomId}/messages` 문서 (`Message` 타입)**
  - 필수 필드: `senderId`, `senderName`, `senderAvatar`, `isCharacter`, `characterId`, `text`, `timestamp`.
  - 선택 필드: `imageUrl`, `generatedImageUrl`, `imageGenPrompt`, `imageError`, `emotion`, `isLoading`, `isFinal`, `forkRoomIds`.
  - 클라이언트 전용 계산 필드(`MessageList`): `displayImageUrl`, `emotion` 추론, 갤러리 이미지 선택.
- **`characters` 문서**
  - 핵심 필드: `name`, `description`, `detail`, `image`, `additionalImages`, `isNSFW`, `isBanmal`, `creatorId`, `firstMessage`, `tags`, `conversationCount`, `likesCount`, `likedBy`.
  - 채팅 중 캐릭터 토글, 감정 기반 이미지 매칭, 페르소나 선택 등에 사용.
- **`users` 문서**
  - 서브 필드: `settings` (모델, 메모리 한도, NSFW 허용, LTM 여부, 프롬프트 모드 등), `selectedPersonaId`, 관리자 권한.
- **보조 컬렉션**
  - `galleries/{characterId}`: 감정/태그 기반 추가 이미지.
  - 포인트/파트론 관련 컬렉션은 LLM 호출 비용 및 제한을 제어한다.

#### **4. 그룹 채팅 동작 흐름**
1. **채팅방 로딩**
   - `chatRooms/{roomId}` 문서를 읽고, `isGroupChat` 여부에 따라 필요한 필드를 초기화한다.
   - 그룹일 경우 `characterIds`를 기반으로 `characters` 컬렉션에서 각 캐릭터 문서를 병렬 조회하고, `activeCharacterIds`가 유효한지 보정한다. (`src/app/chat/[roomId]/page.tsx:360` 부근)
   - `nextSpeakerIndex`가 범위를 벗어나면 0으로 리셋한다.
   - 관리 권한이 있는 사용자에 한해 메시지 서브컬렉션에 대한 `onSnapshot` 구독을 열고 최신 `pageSize` 만큼 수신한다.

2. **사용자 메시지 전송**
   - 사용자가 텍스트/이미지를 제출하면 Firestore에 즉시 메시지를 기록하고, 필요 시 Storage 업로드를 수행한다.
   - 전송 후 `generateBotResponses`를 호출하여 그룹 응답 시퀀스를 비동기로 트리거한다.

3. **봇 응답 생성 (`generateBotResponses`)**
   - 최신 채팅방 상태를 재조회하여 경쟁 조건을 줄이고, `activeCharacterIds` 순서에 따라 캐릭터별 루프를 수행한다.
   - 각 캐릭터에 대해
     - Firestore에 `isLoading` 메시지를 추가(typing indicator).
     - `POST /api/chat/bot-response` 요청을 보낸다. 요청에는 `roomId`, `characterId`, `characterName`, `characterInfo(detail/description)`, `senseiName`, `lastMessage`, `imageUrl`(직전 메시지 첨부), `isNSFW`, `enableNSFW`, `isBanmal`, 사용자 `uid`, `lorebookIds`, 선택된 페르소나 정보가 포함된다.
     - 응답 수신 후 메시지 문서를 업데이트하고, 감정 태그와 LTM/요약 관련 메타데이터를 반영한다.
     - 이미지 생성이 활성화된 경우 `/api/generate-image` 호출로 추가 이미지를 비동기로 생성하고 Firestore에 업데이트한다.
     - 성공한 메시지는 `vector/index-message` API로 색인 작업을 fire-and-forget 방식으로 전달한다.
   - 각 캐릭터 응답이 완료될 때마다 `accumulatedMessages`에 추가하여 다음 캐릭터가 최신 맥락을 사용할 수 있게 한다.
   - 루프 종료 후 `chatRooms` 문서의 `lastMessage`, `lastUpdated`, `nextSpeakerIndex`를 업데이트한다. 에러가 발생하면 해당 캐릭터 메시지에 `(응답 오류)` 표기를 남기거나 인덱스만 조정한다.

4. **턴 순환 및 자동화**
   - `nextSpeakerIndex`는 `activeCharacterIds` 배열을 기준으로 회전하며, 캐릭터 활성/비활성, 추가/제거 시 인덱스를 재조정한다.
   - `Continue Conversation` 기능은 사용자가 없는 동안 순서를 유지한 채 모든 활성 캐릭터에 대해 자동으로 위 루프를 반복한다. 응답이 전혀 생성되지 않으면 `.` 메시지로 자리표시를 남기고 인덱스만 유지한다.

#### **5. 동적 프로필 및 렌더링**
- `MessageList` 컴포넌트는 각 메시지의 `senderAvatar`, `senderName`, `isCharacter` 정보를 사용하여 발화자 프로필을 실시간 표시한다.
- 캐릭터 메시지일 경우 `displayImageUrl`을 계산한다.
  - 우선순위: `generatedImageUrl` → 캐릭터 `additionalImages`에서 감정/태그 매칭 → 갤러리 서비스(`galleries/{characterId}`) → 첨부 이미지 → 기본 아바타.
  - 감정 라벨은 응답에 포함된 `emotion` 필드 또는 텍스트 분석(`resolveEmotionFromText`)으로 추론한다.
- UI 스킨(`classic`/`novel`)과 배경 이미지는 `chatRooms.ui` 설정을 통해 제어하며, 헤더에서 즉시 변경하고 Firestore에 저장할 수 있다.
- 플레이어가 페르소나를 선택하면 `users/{uid}.selectedPersonaId` 갱신 및 아바타 표시, 이미지 생성 컨텍스트에 반영된다.

#### **6. 관리 및 설정 기능**
- **캐릭터 관리 (`ManageCharactersModal`)**
  - 사용자 개인/공개 캐릭터를 검색하여 채팅방에 추가하거나 제거한다.
  - 활성화 토글은 최소 1명 유지 조건을 갖추며, 토글 시 `activeCharacterIds`와 `nextSpeakerIndex`가 즉시 재계산된다.
- **채팅방 전환 (`ConversionButton`, `ConversionModal`)**
  - 그룹 → 개인: 활성 캐릭터가 1~2명일 때 허용, 선택된 캐릭터만 남기고 `characterIds`/`activeCharacterIds`를 정리한다.
  - 개인 → 그룹: 기존 단일 캐릭터를 초기 멤버로 넣고 그룹 필드를 초기화한다.
  - API는 관리자/방 생성자 권한을 검사하고 `conversionHistory`에 로그를 남긴다.
  - `autoConvertToPrivate`가 활성화된 그룹 방에서 활성 캐릭터가 1명만 남으면 자동으로 전환 API를 호출한다.
- **기타 설정**
  - `ChatRoomSettingsModal`: 자동 전환 스위치, 전환 이력 표시.
  - `ChatHeader`: 그룹 이미지 변경(Storage 업로드 후 Firestore 업데이트), 방 이름 수정, 링크 공유, 로어북 설정, 채팅 내보내기, 삭제.
  - `LorebookSettingsModal`: 방/캐릭터 로어북 우선순위 조정 및 연동.

#### **7. 추가 시나리오 및 통합**
- **페르소나 선택**: 사용자 페르소나는 `characters` 컬렉션을 공유하며, 선택 시 메시지 입력 UI와 이미지 생성 컨텍스트에 적용된다.
- **Forking**: 메시지에서 분기를 생성하면 `forkRoomIds`와 `parentRoomId`를 활용하여 새로운 방을 관리한다.
- **기억/요약 파이프라인**
  - `bot-response` API는 RAG 구성을 환경변수에서 읽어 백그라운드 검색(`retrieveAugmentedContext`)과 요약(`runSupaSummarization`, `runHypaRollup`)을 수행한다.
  - `shouldRollSupa`/`shouldRollHypa` 정책에 따라 자동으로 장기 요약을 업데이트하고, 필요 시 포인트 차감을 선행 검증한다.
- **포인트 시스템**: 모델별로 입력 토큰 수를 산정하여 포인트 차감 여부를 계산하고, 무료 모델/프리뷰 모델인 경우에도 0원 거래내역을 기록한다.

#### **8. 예외 처리 및 패턴**
- 그룹 캐릭터 데이터가 누락되면 경고를 출력하고 해당 캐릭터 응답을 건너뛰며, 인덱스는 유지한다.
- LLM 응답이 실패하면 메시지에 `(응답 오류)` 문구를 저장하고 `isLoading`을 false 처리한다.
- `activeCharacterIds`가 비어 있는 경우 즉시 복구하거나 사용자에게 최소 1명 유지 알림을 띄운다.
- `generateBotResponses` 외부에서 발생한 오류는 사용자 알림(`notifications`)과 콘솔 로깅을 통해 추적한다.
- 백엔드 포인트 확인 단계에서 잔액 부족 시 402 응답을 반환하며, 프런트엔드는 이를 사용자에게 노출한다.

#### **9. 기술적 고려사항**
- Firestore 읽기/쓰기:
  - 그룹 응답 한 턴당 최소 `activeCharacterIds` 수만큼 API 호출과 Firestore 쓰기가 발생한다(typing + 최종 메시지 + room 메타데이터).
  - 메시지 구독은 `limitToLast(pageSize)`로 제한하지만 `Continue Conversation` 시 전체 히스토리를 재조회한다.
- 순차 처리:
  - 캐릭터 응답은 현재 동기 반복으로 실행하여 순서와 컨텍스트 일관성을 보장한다. 필요 시 병렬화 고려.
- 이미지 생성:
  - `/api/generate-image` 실패 시 `imageError` 플래그를 세팅하고 UI에서 재생성 모달로 처리한다.
- Vector/RAG 연동:
  - 각 응답 후 백엔드에 색인 요청을 보내지만 실패 시 워닝만 남기고 채팅 흐름은 계속된다.
- 로깅:
  - 주요 상태 변화(`nextSpeakerIndex`, 포인트 처리, 이미지 생성 등)는 콘솔에 로그되어 디버깅을 지원한다.

---

본 명세는 현재 저장소 상태를 기준으로 작성되었으며, 코드 구조 변경 시 함께 업데이트해야 한다.
