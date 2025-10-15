export type ChatSkin = 'classic' | 'novel';

// Firebase Timestamp type
export interface FirebaseTimestamp {
  toDate: () => Date;
}

// Message interface
export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  personaAvatar?: string; // 페르소나 아바타 URL (페르소나 사용 시)
  isCharacter: boolean;
  characterId: string;
  text: string;
  imageUrl: string; // Firestore에 저장 시 빈 문자열일 수 있음
  timestamp: any; // FieldValue | FirebaseTimestamp | Date | string | number; // Firestore FieldValue 허용
  isLoading?: boolean; // 추가: 메시지 로딩 상태 (봇 응답 대기 중)
  generatedImageUrl?: string | null; // 추가: NovelAI로 생성된 이미지 URL, null 허용
  imageError?: boolean; // 추가: 이미지 생성 오류 메시지
  imageGenPrompt?: string | null; // 추가: Vertex AI가 생성한 이미지 프롬프트, null 허용
  isForked?: boolean; // 이 메시지 이후로 분기가 생성되었는지
  forkRoomIds?: string[]; // 이 메시지에서 생성된 분기 채팅방 ID들

  // 클라이언트 전용(렌더링 편의) 확장 필드
  displayImageUrl?: string; // 렌더링용 최종 이미지 URL
  emotion?: string; // 감정 추정값
  imageData?: unknown; // 임시 이미지 데이터(업로드 중 등)
  isFinal?: boolean; // 메시지 확정 여부
}

// Character interface
export interface Character {
  id: string;
  name: string;
  description: string;
  creatorId: string;
  image?: string;
  additionalImages?: string[]; // Added additionalImages property
  detail?: string;
  firstMessage?: string;
  isNSFW: boolean;
  isBanmal: boolean;
  isPublic?: boolean; // Added based on usage in fetchAvailableCharacters
  // @typescript-eslint/no-explicit-any
  createdAt?: Date; // Added based on usage in fetchAvailableCharacters
  tags?: string[];
  conversationCount: number;
  likesCount: number;
  likedBy: string[];
  requiredImageTags?: string; // 추가: 이미지 생성 시 필수 태그
  customEmotions?: string[]; // 추가: 커스텀 감정 라벨 (선택적)
}

// Chat room interface
export interface ChatRoom {
  id: string;
  name: string;
  description?: string;
  creatorId?: string;
  creatorName?: string;
  image?: string;
  characterId?: string; // Keep for potential backward compatibility or single chats
  characterIds?: string[]; // Array of character IDs for group chat
  characters?: Character[]; // Array of full character objects
  isGroupChat: boolean; // Flag for group chat (필수로 간주)
  activeCharacterIds?: string[]; // IDs of characters currently active in the conversation
  nextSpeakerIndex?: number; // Index in activeCharacterIds for the next speaker
  character?: Character; // Keep for single chat logic temporarily
  isNSFW?: boolean;
  lastUpdated?: Date;
  lastMessage?: string; // Added based on usage in sendMessage
  members?: number;
  tags?: string[];
  lorebookIds?: string[]; // 추가: 연결된 로어북 ID 배열 (선택적)
  parentRoomId?: string; // 분기된 원본 채팅방 ID
  forkPoint?: {
    messageId: string; // 분기 기준 메시지 ID
    timestamp: any; // 분기 시점
    description?: string; // 분기 사유
  };
  isFork?: boolean; // 분기된 채팅방 여부 (기본값: false)
  forkRoomIds?: string[]; // 이 채팅방에서 생성된 분기들
  autoConvertToPrivate?: boolean; // 1명 남을 때 자동 전환 옵션
  conversionHistory?: {
    fromType: 'group' | 'private';
    toType: 'group' | 'private';
    timestamp: any; // Firebase Timestamp
    reason: string;
    triggeredBy: 'auto' | 'manual';
    characterId?: string; // 전환 시 남은 캐릭터 ID (private로 전환 시)
  }[];
}

// Props for components might also go here or in the component file itself

// User interface (based on useAuth context)
export interface User {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  // Add other properties from your user object if needed
}


export interface RoomUIConfig {
  skin: ChatSkin;
  backgroundImage?: string | null;
  overlayOpacity?: number;
  blur?: number;
  accentColor?: string;
  narrativeMaxWidth?: number;
  imageMessageWidth?: number;
  borderRadius?: number;
  shadow?: 'none' | 'subtle' | 'elevated';
  updatedAt?: unknown;
}

export function normalizeRoomUI(ui?: Partial<RoomUIConfig>): RoomUIConfig {
  const defaults: RoomUIConfig = {
    skin: 'classic',
    backgroundImage: null,
    overlayOpacity: 0.6,
    blur: 8,
    accentColor: undefined,
    narrativeMaxWidth: 920,
    imageMessageWidth: 720,
    borderRadius: 10,
    shadow: 'subtle',
    updatedAt: undefined,
  };

  return {
    ...defaults,
    ...(ui ?? {}),
    // 안전한 덮어쓰기: 숫자/문자/선택값 등은 명시 존재 시 우선
    skin: (ui?.skin as ChatSkin) ?? defaults.skin,
    backgroundImage: ui?.backgroundImage ?? defaults.backgroundImage,
    overlayOpacity: ui?.overlayOpacity ?? defaults.overlayOpacity,
    blur: ui?.blur ?? defaults.blur,
    accentColor: ui?.accentColor ?? defaults.accentColor,
    narrativeMaxWidth: ui?.narrativeMaxWidth ?? defaults.narrativeMaxWidth,
    imageMessageWidth: ui?.imageMessageWidth ?? defaults.imageMessageWidth,
    borderRadius: ui?.borderRadius ?? defaults.borderRadius,
    shadow: (ui?.shadow as RoomUIConfig['shadow']) ?? defaults.shadow,
    updatedAt: ui?.updatedAt ?? defaults.updatedAt,
  };
}