'use client';

import React, { useState, useEffect, useRef } from 'react'; // Import React
import { Container, Paper, Text, Group, Button, Loader, Stack, ThemeIcon, Modal, Checkbox, Textarea, Image, Box } from '@mantine/core'; // Added Modal, Checkbox, Box
import NovelChatShell from '@/components/chat/novel/NovelChatShell';
import NovelHeader from '@/components/chat/novel/NovelHeader';
import NovelMessageList from '@/components/chat/novel/NovelMessageList';
import NovelMessageInput from '@/components/chat/novel/NovelMessageInput';
import ClassicChatShell from '@/components/chat/classic/ClassicChatShell';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { db, storage } from '@/firebase/config';
import { doc, getDoc, onSnapshot, updateDoc, setDoc, arrayUnion, serverTimestamp, deleteDoc, collection, query, where, orderBy, limit, limitToLast, getDocs, addDoc, deleteField, startAfter } from 'firebase/firestore'; // Added addDoc, deleteField, startAfter
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { useSettings } from '@/contexts/SettingsContext'; // Import useSettings
import { IconArrowBack, IconAlertCircle, IconDownload, IconBook, IconUsers, IconCheck, IconX } from '@tabler/icons-react'; // Added IconDownload, IconBook, IconUsers, IconCheck, IconX
import { useDebouncedCallback } from 'use-debounce';
import { notifications } from '@mantine/notifications';
import AppShell from '@/components/layout/AppShell';
import { normalizeRoomUI, type RoomUIConfig, type Message, type Character, type ChatRoom } from '@/types/chat';
import { resolveEmotionFromText, selectGalleryImageByEmotion, selectAdditionalImageByEmotion } from '@/utils/gallery';

/* 로컬 임시 타입 제거: 공용 타입('@/types/chat') 사용 */
import MessageInput from '@/components/chat/MessageInput';
import MessageList from '@/components/chat/MessageList';
import ChatHeader from '@/components/chat/ChatHeader';
import EditMessageModal from '@/components/chat/EditMessageModal';
import DeleteConfirmModal from '@/components/chat/DeleteConfirmModal';
import ManageCharactersModal from '@/components/chat/ManageCharactersModal';
import { LorebookSettingsModal } from '@/components/chat/LorebookSettingsModal'; // 로어북 설정 모달 임포트
import { ChatRoomSettingsModal } from '@/components/chat/ChatRoomSettingsModal'; // 채팅방 설정 모달 임포트
import ConversionModal from '@/components/chat/ConversionModal'; // 전환 모달 임포트
import ConversionButton from '@/components/chat/ConversionButton'; // 전환 버튼 임포트
import ForksList from '@/components/chat/ForksList'; // 분기 목록 컴포넌트 임포트
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import Cookies from 'js-cookie';
import { IconPhotoEdit } from '@tabler/icons-react';
import { useKeyboardHandler } from '@/hooks/useKeyboardHandler'; // 키보드 핸들러 임포트

const renderTextWithFormatting = (text: string): string => {
  // 0) Tag/Emotion 패턴 제거 (메시지 화면에 보이지 않게)
  let processedText = String(text || '').replace(/^\s*-?\s*(?:Tag|Emotion):.*$/gim, '');

  const lines = processedText.split('\n');
  let lastHeaderLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    // "## " (공백 포함) 또는 "---" 로 시작하는 줄을 헤더로 간주합니다.
    if (/^\s*##/.test(lines[i]) || lines[i].startsWith('---')) {
      lastHeaderLineIndex = i;
    }
  }

  processedText = processedText; // 기본값은 원본 텍스트입니다.
  if (lastHeaderLineIndex !== -1) {
    // 마지막 헤더 줄 다음부터의 텍스트를 가져옵니다.
    processedText = lines.slice(lastHeaderLineIndex + 1).join('\n').trim();
  }
  // 헤더가 없는 경우, processedText는 원본 text가 됩니다.
  // 이 경우, "## 일반 텍스트"와 같은 줄은 제거되지 않고 그대로 표시될 수 있습니다.
  // 사용자의 피드백은 특정 헤더 이후의 내용에 초점을 맞추고 있으므로, 이 동작이 의도된 것일 수 있습니다.

  // 이탤릭체(*...*)와 볼드체(**...**)를 모두 캡처하는 정규식
  return processedText;
};

export default function ChatRoomPage() {
  const debouncedUpdateUISkin = useDebouncedCallback(async (roomIdStr: string, value: 'classic' | 'novel') => {
    try {
      const roomRef = doc(db, 'chatRooms', roomIdStr);
      await updateDoc(roomRef, {
        'ui.skin': value,
        'ui.updatedAt': serverTimestamp(),
      });
    } catch (e) {
      console.warn('Failed to update ui.skin', e);
      try {
        notifications.show({ color: 'yellow', title: 'UI 업데이트 실패', message: 'UI 스타일 변경 저장에 실패했습니다.' });
      } catch {}
    }
  }, 400);

  const handleUpdateUISkin = (value: 'classic' | 'novel') => {
    setRoomUI((prev: RoomUIConfig) => ({ ...prev, skin: value }));
    const rid = typeof roomId === 'string' ? roomId : '';
    if (rid) debouncedUpdateUISkin(rid, value);
  };
  // Get the roomId directly from params
  const params = useParams();
  const roomId = Array.isArray(params.roomId) ? params.roomId[0] : params.roomId;
  
  // 🔍 DEBUG LOG: roomId 파라미터 추출 로그
  console.log('[DEBUG] roomId extraction:', {
    rawParams: params,
    roomId,
    roomIdType: typeof roomId,
    isArray: Array.isArray(params.roomId),
    roomIdValue: roomId
  });
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomUI, setRoomUI] = useState<RoomUIConfig>(normalizeRoomUI()); // UI 상태
  const [galleryItems, setGalleryItems] = useState<{ url: string; weight?: number; tags?: string[] }[]>([]);
  const [selectedBgUrl, setSelectedBgUrl] = useState<string | null>(null);
  
  // 이미지 선택은 onSnapshot에서 m.displayImageUrl로 계산됩니다.

  // 캐릭터 기반 갤러리 병합 헬퍼
  const mergeCharacterGalleries = (docs: any[]): { url: string; weight?: number; tags?: string[] }[] => {
    const merged: { url: string; weight?: number; tags?: string[] }[] = [];
    for (const d of docs) {
      if (!d.exists()) continue;
      const data = d.data() as any;
      const items = Array.isArray(data.items) ? data.items : [];
      for (const it of items) {
        if (typeof it?.url === 'string' && it.url) {
          merged.push({
            url: it.url,
            weight: typeof it.weight === 'number' ? it.weight : 1,
            tags: Array.isArray(it.tags) ? it.tags.map((t: any) => String(t)) : [],
          });
        }
      }
    }
    return merged;
  };

  // 모바일 감지 및 키보드 핸들러
  const isMobile = useMediaQuery('(max-width: 768px)');
  const { isKeyboardOpen, keyboardHeight, viewportHeight } = useKeyboardHandler();

  // Pagination state
  const pageSize = 20;
  const [oldestDoc, setOldestDoc] = useState<any>(null);
  const [newestDoc, setNewestDoc] = useState<any>(null);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [imageUpload, setImageUpload] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingMessage, setEditingMessage] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [rerollingMessageId, setRerollingMessageId] = useState<string | null>(null); // State to track which message is rerolling
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState(false); // State for delete confirmation
  const [isManageCharsModalOpen, setIsManageCharsModalOpen] = useState(false); // State for managing characters modal
  const [rerollingMessage, setRerollingMessage] = useState(false);
  const [continuingConversation, setContinuingConversation] = useState(false); // Loading state for auto-continue
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevMessagesLengthRef = useRef<number>(messages.length); // Ref to store previous messages length
  const prevIsLoadingMoreRef = useRef<boolean>(false); // Ref to track previous loading state for infinite scroll
  // 이미지 재성성 관련 상태
  const [isRegenerateImageModalOpen, setIsRegenerateImageModalOpen] = useState(false);
  const [regenerateImageInfo, setRegenerateImageInfo] = useState<{ messageId: string, imageUrl?: string, currentPrompt?: string } | null>(null); // imageUrl을 optional로 변경
  const [newRegeneratePrompt, setNewRegeneratePrompt] = useState('');
  const [regeneratingImageId, setRegeneratingImageId] = useState<string | null>(null);
  const [isRegeneratingImage, setIsRegeneratingImage] = useState(false); // State for image regeneration loading
  const [lorebookOrderMode, setLorebookOrderMode] = useState<'room_first' | 'character_first'>('room_first');

  // Scroll delay to ensure elements finish rendering before scrolling
  const SCROLL_DELAY_MS = 1500; // 1.5s delay
  const initialScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load older messages when scrolling up (infinite scroll)
  const loadOlderMessages = async () => {
    if (!roomId || !oldestDoc || isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
      const olderQuery = query(
        messagesColRef,
        orderBy('timestamp', 'desc'),
        startAfter(oldestDoc),
        limit(pageSize)
      );
      const olderSnapshot = await getDocs(olderQuery);
      const docs = olderSnapshot.docs;
      if (docs.length < pageSize) {
        setHasMore(false);
      }
      if (docs.length > 0) {
        // Convert and reverse to ascending
        const olderMessagesAsc = docs.slice().reverse().map(doc => {
          const data = doc.data();
          const timestamp =
            data.timestamp?.toDate ? data.timestamp.toDate() :
            typeof data.timestamp === 'string' || typeof data.timestamp === 'number' ? new Date(data.timestamp) :
            new Date();
          return {
            id: doc.id,
            senderId: data.senderId,
            senderName: data.senderName,
            senderAvatar: data.senderAvatar || '',
            isCharacter: data.isCharacter || false,
            characterId: data.characterId || '',
            text: data.text,
            imageUrl: data.imageUrl || '',
            generatedImageUrl: data.generatedImageUrl || undefined, // 추가: 생성된 이미지 URL 읽기
            emotion: data.emotion || undefined,
            imageGenPrompt: data.imageGenPrompt || undefined, // 추가: 이미지 생성 프롬프트 읽기
            imageError: data.imageError || false, // 추가: 이미지 생성 오류 상태 읽기
            timestamp,
          } as Message;
        });
        setMessages(prev => [...olderMessagesAsc, ...prev]);
        // Update pagination cursor
        setOldestDoc(docs[docs.length - 1]);
      }
    } catch (err) {
      console.error('Error loading older messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };
  const { user, uid } = useAuth(); // Assuming useAuth provides the User object
  const { settings } = useSettings(); // Get settings from context
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [personaCharacterImage, setPersonaCharacterImage] = useState<string | null>(null); // State for persona image
  const [personaName, setPersonaName] = useState<string | null>(null); // State for persona name
  const latestSpeakerIndexRef = useRef<number>(0); // Ref to store the latest committed speaker index
  const [selectedPersonaId, setSelectedPersonaIdState] = useState<string | null>(null); // State for selected persona ID
  const [userPersonas, setUserPersonas] = useState<Character[]>([]); // State for user's available personas
  const [loadingUserPersonas, setLoadingUserPersonas] = useState(false);
  const [ ,setAvailableCharacters] = useState<Character[]>([]); // State for characters available to add
  const [ ,setLoadingAvailableChars] = useState(false); // Loading state for available characters
  const [charactersToAdd, setCharactersToAdd] = useState<string[]>([]); // State for characters selected to be added
  const [isPlayerActive, setIsPlayerActive] = useState(true); // State for player's active status in conversation
  const isFirstMessageAddedRef = useRef(false); // Ref to track if first message logic ran
  const [isUploadingImage, setIsUploadingImage] = useState(false); // State for chat room image upload
   const [openedExport, { open: openExportModal, close: closeExportModal }] = useDisclosure(false); // Export modal state
   const [includeUserMessages, setIncludeUserMessages] = useState(true);
   const [exportLoading, setExportLoading] = useState(false);
   const [lorebookModalOpened, { open: openLorebookModal, close: closeLorebookModal }] = useDisclosure(false); // 로어북 모달 상태
   
   // 전환 기능 관련 상태
   const [chatRoomSettingsModalOpened, { open: openChatRoomSettingsModal, close: closeChatRoomSettingsModal }] = useDisclosure(false);
   const [conversionModalOpened, { open: openConversionModal, close: closeConversionModal }] = useDisclosure(false);
   const [conversionSettings, setConversionSettings] = useState<{
     fromType: 'group' | 'private';
     toType: 'group' | 'private';
     auto: boolean;
   } | null>(null);
   const [isConverting, setIsConverting] = useState(false);
 
   // Fetch chat room data and setup real-time listener
   useEffect(() => {
    if (!roomId || !user) return;

    let unsubscribe: (() => void) | undefined;
    const isActive = true; // Track if component is still mounted

    const loadingTimeout = setTimeout(() => {
      if (isActive) {
        setLoading(false);
        setError('채팅방을 불러오는 중 시간 초과가 발생했습니다. 다시 시도해 주세요.');
        console.error('Loading timeout exceeded for chat room:', roomId);
      }
    }, 15000); // Increased timeout to 15 seconds

    const setupChatRoom = async () => {
      try {
        setLoading(true);
        setError(null);
        setPersonaCharacterImage(null); // Reset persona image on setup
        setPersonaName(null); // Reset persona name on setup

        // Check if chat room exists first
        const roomDocRef = doc(db, 'chatRooms', String(roomId)); // Ensure roomId is string
        const roomDoc = await getDoc(roomDocRef);

        if (!roomDoc.exists()) {
          if (isActive) {
            setError('존재하지 않는 채팅방입니다.');
            setLoading(false);
            clearTimeout(loadingTimeout);
          }
          return;
        }

        // Access control: creator or admin/subadmin can access this room
        const roomDataForAccess = roomDoc.data() as any;
        const isPrivileged = !!((user as any)?.isAdmin || (user as any)?.isSubadmin);
        if (!roomDataForAccess || (roomDataForAccess.creatorId !== user.uid && !isPrivileged)) {
          if (isActive) {
            setError('접근 권한이 없습니다.');
            try { notifications.show({ title: '접근 차단', message: '이 채팅방에 접근할 수 없습니다.', color: 'red' }); } catch {}
            setLoading(false);
            clearTimeout(loadingTimeout);
            router.replace('/chat');
          }
          return;
        }

        // Fetch user document and selected persona
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        let currentPersonaId: string | null = null;

        if (!userDoc.exists()) {
          // Initialize user document if it doesn't exist
          await setDoc(userDocRef, {
            displayName: user.displayName || '사용자',
            email: user.email || '',
            photoURL: user.photoURL || '',
            createdAt: serverTimestamp(),
            recentChats: [],
            membershipTier: 'none',
            settings: {
              theme: 'light',
              notifications: true,
              memoryCapacity: 25,
              enableImageGeneration: false,
              enableNSFW: true,
              aiModel: 'gemini-2.5-flash-preview-04-17'
            }
          });
          console.log('User document created');
        } else {
           // --- Fetch and Set Selected Persona ID ---
           const userData = userDoc.data();
           const storedPersonaId = userData.selectedPersonaId || null;
           setSelectedPersonaIdState(storedPersonaId); // Update the state
           currentPersonaId = storedPersonaId; // Keep using local variable for initial persona image fetch below
           // --- End Fetch and Set Selected Persona ID ---
        }

        // --- Fetch Persona Character Image (if ID exists) ---
        // This part remains largely the same, using the initially fetched currentPersonaId
        if (currentPersonaId) {
          try {
            const personaCharDocRef = doc(db, 'characters', currentPersonaId);
            const personaCharDoc = await getDoc(personaCharDocRef);
            if (personaCharDoc.exists() && isActive) {
              const personaData = personaCharDoc.data();
              // Set persona image/name based on the initially loaded ID
              setPersonaCharacterImage(personaData.image || null);
              setPersonaName(personaData.name || null);
              console.log("Initial Persona image loaded:", personaData.image);
              console.log("Initial Persona name loaded:", personaData.name);
            } else if (isActive) {
               console.warn(`Selected persona character ${currentPersonaId} not found.`);
               // Optionally clear the invalid persona from user settings here
               // Consider setting selectedPersonaIdState(null) here if the stored ID is invalid
               // await updateDoc(userDocRef, { selectedPersonaId: deleteField() });
            }
          } catch (personaError) {
            console.error("Error fetching selected persona character:", personaError);
          }
        }
        // --- End Fetch Persona Character Image ---

        // Process room data (only if component is still active)
        if (!isActive) return;
        const roomData = roomDoc.data();
        const room: ChatRoom = {
          id: roomDoc.id,
          name: roomData.name,
          description: roomData.description,
          creatorId: roomData.creatorId,
          creatorName: roomData.creatorName,
          image: roomData.image,
          characterId: roomData.characterId, // Keep for single chat
          characterIds: roomData.characterIds || [], // Get character IDs
          isGroupChat: roomData.isGroupChat || false, // Get group chat flag
          activeCharacterIds: roomData.activeCharacterIds || (roomData.isGroupChat ? roomData.characterIds || [] : []), // Get active IDs or default to all if group
          nextSpeakerIndex: roomData.nextSpeakerIndex !== undefined ? roomData.nextSpeakerIndex : (roomData.isGroupChat ? 0 : -1), // Get speaker index or default
          isNSFW: roomData.isNSFW || false,
          lastUpdated: roomData.lastUpdated?.toDate(),
          members: roomData.members || 0,
          tags: roomData.tags || [],
          lorebookIds: roomData.lorebookIds || [], // lorebookIds 추가
          characters: [],
        };

        // Fetch character data based on chat type
        if (room.isGroupChat && room.characterIds && room.characterIds.length > 0) {
          // Fetch all characters for group chat
          try {
            const characterDocs = await Promise.all(
              room.characterIds.map(id => getDoc(doc(db, 'characters', id)))
            );
            room.characters = characterDocs
              .filter(doc => doc.exists())
              .map(doc => ({ id: doc.id, ...doc.data() } as Character));

            // Ensure activeCharacterIds are valid and present in fetched characters
            const fetchedCharacterIds = new Set(room.characters.map(c => c.id));
            room.activeCharacterIds = room.activeCharacterIds?.filter(id => fetchedCharacterIds.has(id));
            if (!room.activeCharacterIds || room.activeCharacterIds.length === 0) {
              // If active IDs are invalid or empty, reset to all fetched characters
              room.activeCharacterIds = room.characters.map(c => c.id);
              room.nextSpeakerIndex = 0; // Reset speaker index
            } else {
              // Adjust nextSpeakerIndex if it's out of bounds
              if (room.nextSpeakerIndex === undefined || room.nextSpeakerIndex < 0 || room.nextSpeakerIndex >= room.activeCharacterIds.length) {
                room.nextSpeakerIndex = 0;
              }
            }

          } catch (charError) {
            console.error("Error fetching characters for group chat:", charError);
            setError('그룹 채팅 캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
            // Potentially handle this more gracefully, e.g., allow chat but disable character features
          }
        } else if (room.characterId) {
          // Fetch single character for non-group chat (existing logic)
          const characterDocRef = doc(db, 'characters', room.characterId);
          const characterDoc = await getDoc(characterDocRef);
          if (characterDoc.exists()) {
            const characterData = characterDoc.data();
            const singleCharacter = {
              id: characterDoc.id,
              name: characterData.name,
              description: characterData.description,
              creatorId: characterData.creatorId,
              image: characterData.image,
              additionalImages: characterData.additionalImages || [],
              detail: characterData.detail,
              firstMessage: characterData.firstMessage,
              isNSFW: characterData.isNSFW || false,
              isBanmal: characterData.isBanmal || false,
              tags: characterData.tags || [],
              conversationCount: characterData.conversationCount || 0,
              likesCount: characterData.likesCount || 0,
              likedBy: characterData.likedBy || [],
            };
            room.character = singleCharacter; // Keep single character object
            room.characters = [singleCharacter]; // Also store in the array for consistency if needed elsewhere
          }
        }

        // Only update state if component is still active and no critical error occurred during character fetch
        if (isActive && !error) {
          setLorebookOrderMode((roomData as any)?.lorebookOrderMode || 'room_first');
          setChatRoom(room);
          // UI 설정 정규화 (rooms 문서에 ui가 없을 수 있으므로 기본값 적용)
          const normalized = normalizeRoomUI((roomData as any).ui ?? undefined);
          setRoomUI(normalized);

          // --- Fetch available characters now that chatRoom state is set ---
          if (room.characterIds) {
             fetchAvailableCharacters(room.characterIds);
          } else if (room.characterId) {
             fetchAvailableCharacters([room.characterId]);
          } else {
             fetchAvailableCharacters([]);
          }
          // --- End fetch available characters ---
          // --- Add first message if messages subcollection is empty ---
          const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
          const initialMessagesQuery = query(messagesColRef, limit(1));
          const initialMessagesSnapshot = await getDocs(initialMessagesQuery);

          // Check if the messages subcollection is initially empty
          // Check if messages are empty AND if the first message logic hasn't run yet for this component instance
          // Check if messages are empty AND if the first message logic hasn't run yet for this component instance
          if (initialMessagesSnapshot.empty && !isFirstMessageAddedRef.current) {
            // Set the flag *before* starting async operations to prevent race conditions
            isFirstMessageAddedRef.current = true;
            console.log("Attempting to add first messages...");

            const firstMessagesToAdd: Promise<void>[] = [];

            // Determine the character(s) to use for the first message based on chat type
            if (room.isGroupChat && room.characters && room.characters.length > 0) {
              // Group Chat: Add first message for all characters that have one
              room.characters.forEach(char => {
                if (char.firstMessage) {
                  const firstMessageData: Omit<Message, 'id' | 'timestamp'> = {
                    senderId: 'bot',
                    senderName: char.name,
                    senderAvatar: char.image || '',
                    isCharacter: true,
                    characterId: char.id,
                    text: char.firstMessage,
                    imageUrl: '',
                  };
                  // Add the promise to the array
                  firstMessagesToAdd.push(
                    addDoc(messagesColRef, {
                      ...firstMessageData,
                      timestamp: serverTimestamp()
                    }).then(() => {
                      console.log(`Added first message for group character ${char.name}`);
                    }).catch(err => {
                      console.error(`Error adding first message for group character ${char.name}:`, err);
                      // Decide if you want to revert the flag or handle errors differently
                    })
                  );
                }
              });
            } else if (!room.isGroupChat && room.character && room.character.firstMessage) {
              // Single Chat: Add first message for the single character
              const firstCharacter = room.character;
              const firstMessageData: Omit<Message, 'id' | 'timestamp'> = {
                senderId: 'bot',
                senderName: firstCharacter.name,
                senderAvatar: firstCharacter.image || '',
                isCharacter: true,
                characterId: firstCharacter.id,
                text: firstCharacter.firstMessage!, // Add non-null assertion
                imageUrl: '',
              };
              // Add the promise to the array
              firstMessagesToAdd.push(
                addDoc(messagesColRef, {
                  ...firstMessageData,
                  timestamp: serverTimestamp()
                }).then(() => {
                  console.log(`Added first message for single character ${firstCharacter.name}`);
                }).catch(err => {
                  console.error(`Error adding first message for single character ${firstCharacter.name}:`, err);
                  // Decide if you want to revert the flag or handle errors differently
                })
              );
            }

            // Wait for all messages to be added (or fail)
            try {
              await Promise.all(firstMessagesToAdd);
              console.log("Finished adding all first messages.");
            } catch (error) {
              console.error("One or more first messages failed to add:", error);
              // Even if some fail, keep the flag true to prevent retries in this session
            }

          } else if (!initialMessagesSnapshot.empty && !isFirstMessageAddedRef.current) {
             // If messages already exist, mark the check as done for this instance
             isFirstMessageAddedRef.current = true;
             console.log("Messages already exist, skipping first message add.");
          } else if (isFirstMessageAddedRef.current) {
             console.log("First message logic already ran for this instance.");
          }
        }


        // Then, set up real-time listener for updates (only if active and no error)
        // Only setup listener if the component is still active
        if (isActive) {
            // The real-time listener for the main room document was here.
            // It's removed because messages are handled separately now.
            unsubscribe = () => {}; // Assign dummy function

            // Update user's recent chats (moved inside the main try block)
            if (user) { // Ensure user exists
              try {
                const userDocRef = doc(db, 'users', user.uid);
                await updateDoc(userDocRef, {
                  // Ensure roomId is a string for arrayUnion
                  recentChats: arrayUnion(String(roomId))
                });
              } catch (updateError) { // Use different variable name
                console.error('Failed to update recent chats:', updateError);
                // Continue even if this fails, it's not critical for chat functionality
              }
            }
          } // This brace should close the 'if (isActive)' block at line 230

        } // <--- This brace closes the main 'try' block starting at line 71
        catch (fetchError) { // Catch errors from the main setupChatRoom try block
          console.error('Error in setupChatRoom:', fetchError);
          if (isActive) { // Check isActive before setting error state
             setError('채팅방 정보를 불러오는 중 오류가 발생했습니다.');
          }
        } finally {
          // This finally block belongs to the main try block of setupChatRoom
          if (isActive) {
            clearTimeout(loadingTimeout);
            setLoading(false);
          }
        }
      }; // End of setupChatRoom function definition

    // --- Function to fetch available characters ---
    // Moved the function definition before its first call within setupChatRoom
    const fetchAvailableCharacters = async (existingIds: string[]) => {
        if (!user || !isActive) return; // Check isActive and user
        setLoadingAvailableChars(true);
        try {
          const charactersRef = collection(db, 'characters');
          const characterData: Character[] = [];
          const existingCharIds = new Set(existingIds);

          // Fetch user's private characters not already in the room
          const userPrivateQuery = query(
            charactersRef,
            where('creatorId', '==', user.uid),
            where('isPublic', '==', false)
          );
          const userPrivateSnapshot = await getDocs(userPrivateQuery);
          userPrivateSnapshot.forEach((doc) => {
            if (!existingCharIds.has(doc.id)) {
              const data = doc.data();
              characterData.push({ id: doc.id, ...data } as Character);
            }
          });

          // Fetch public characters not already in the room
          const publicQuery = query(
            charactersRef,
            where('isPublic', '==', true),
            orderBy('createdAt', 'desc'),
          );
          const publicSnapshot = await getDocs(publicQuery);
          publicSnapshot.forEach((doc) => {
            if (!existingCharIds.has(doc.id) && !characterData.some(c => c.id === doc.id)) { // Avoid duplicates
              const data = doc.data();
              characterData.push({ id: doc.id, ...data } as Character);
            }
          });

          if (isActive) { // Check isActive again before setting state
             setAvailableCharacters(characterData);
          }

        } catch (error) {
          console.error("Error fetching available characters:", error);
          // Handle error appropriately, maybe show a notification
        } finally {
          if (isActive) { // Check isActive
             setLoadingAvailableChars(false);
          }
        }
      };
    // --- End fetch available characters function ---
    // --- End fetch available characters ---

    // Call setupChatRoom directly
    setupChatRoom();

    // Clean up listener when component unmounts
    return () => {
      if (unsubscribe) {
        try {
          unsubscribe();
        } catch (error) {
          console.error("Error unsubscribing from Firestore listener:", error);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, user, router]); // Corrected closing for the first useEffect hook

  // Effect to fetch user's available personas (own private + public)
  useEffect(() => {
    if (!user) return;

    const fetchUserPersonas = async () => {
      setLoadingUserPersonas(true);
      const personas: Character[] = [];
      const charactersRef = collection(db, 'characters');

      try {
        // Fetch user's private characters
        const userPrivateQuery = query(
          charactersRef,
          where('creatorId', '==', user.uid),
          where('isPublic', '==', false)
        );
        const userPrivateSnapshot = await getDocs(userPrivateQuery);
        userPrivateSnapshot.forEach((doc) => {
          personas.push({ id: doc.id, ...doc.data() } as Character);
        });

        // Fetch public characters (limit for performance)
        const publicQuery = query(
          charactersRef,
          where('isPublic', '==', true),
          orderBy('createdAt', 'desc'),
        );
        const publicSnapshot = await getDocs(publicQuery);
        publicSnapshot.forEach((doc) => {
          // Avoid adding duplicates if a user's character is also public
          if (!personas.some(p => p.id === doc.id)) {
            personas.push({ id: doc.id, ...doc.data() } as Character);
          }
        });

        // Sort personas alphabetically by name
        personas.sort((a, b) => a.name.localeCompare(b.name));
        setUserPersonas(personas);

      } catch (error) {
        console.error("Error fetching user personas:", error);
        notifications.show({
          title: '페르소나 로딩 실패',
          message: '사용 가능한 페르소나 목록을 불러오는 중 오류가 발생했습니다.',
          color: 'red',
        });
      } finally {
        setLoadingUserPersonas(false);
      }
    };

    fetchUserPersonas();
  }, [user]);


  // New useEffect hook to listen only the last pageSize messages
  useEffect(() => {
    // Allow messages listener for room creator or admin/subadmin
    const privileged = !!((user as any)?.isAdmin || (user as any)?.isSubadmin);
    if (!user || !chatRoom || (chatRoom.creatorId !== user.uid && !privileged)) return;

    const currentRoomId = typeof chatRoom.id === 'string' ? chatRoom.id : '';
    if (!currentRoomId) return;

    const messagesColRef = collection(db, 'chatRooms', currentRoomId, 'messages');
    const q = query(messagesColRef, orderBy('timestamp', 'asc'), limitToLast(pageSize));

    const unsubscribeMessages = onSnapshot(q, (querySnapshot) => {
      const docs = querySnapshot.docs;
      const fetchedMessages: Message[] = docs.map(doc => {
        const data = doc.data();
        const timestamp = data.timestamp?.toDate
          ? data.timestamp.toDate()
          : (typeof data.timestamp === 'string' || typeof data.timestamp === 'number'
            ? new Date(data.timestamp)
            : new Date());
      
        const base: Message = {
          id: doc.id,
          senderId: data.senderId,
          senderName: data.senderName,
          senderAvatar: data.senderAvatar || '',
          isCharacter: data.isCharacter || false,
          characterId: data.characterId || '',
          text: data.text,
          imageUrl: data.imageUrl || '',
          generatedImageUrl: data.generatedImageUrl ?? undefined,
          emotion: data.emotion ?? undefined,
          imageGenPrompt: data.imageGenPrompt ?? undefined,
          imageError: data.imageError || false,
          timestamp,
          imageData: data.imageData,
          isFinal: data.isFinal ?? undefined,
        } as any;
      
        // displayImageUrl은 클라이언트 전용. isFinal이고 캐릭터 메시지일 때만 계산.
        if (base.isCharacter && base.isFinal) {
          base.displayImageUrl = (() => {
            // 1) 생성 이미지
            if (base.generatedImageUrl) return base.generatedImageUrl || undefined;
      
            // 2) 캐릭터 additionalImages 감정 매칭
            if (chatRoom?.characters && base.characterId) {
              const character = chatRoom.characters.find(c => c.id === base.characterId);
              if (character?.additionalImages?.length) {
                const emotion = base.emotion || resolveEmotionFromText(base.text);
                const addImg = selectAdditionalImageByEmotion(
                  emotion,
                  character.additionalImages,
                  undefined,
                  { characterTags: Array.isArray(character.tags) ? character.tags : undefined }
                );
                if (addImg) return addImg;
              }
            }
      
            // 3) 갤러리 감정 매칭
            const emotion = base.emotion || resolveEmotionFromText(base.text);
            const byEmotion = selectGalleryImageByEmotion(emotion, galleryItems);
      
            // 4) 첨부 이미지
            return byEmotion || (base.imageUrl || undefined);
          })() || undefined;
        } else {
          base.displayImageUrl = undefined;
        }
      
        return base;
      });
      
      // 메시지 상태 반영
      setMessages(fetchedMessages);
      if (docs.length > 0) {
        setOldestDoc(docs[0]);
        setNewestDoc(docs[docs.length - 1]);
        if (docs.length < pageSize) {
          setHasMore(false);
        }
      }
    }, (error) => {
      console.error("Error listening to messages subcollection:", error);
      if (!error) {
        setError('메시지를 불러오는 중 오류가 발생했습니다.');
      }
    });

    return () => {
      unsubscribeMessages();
    };
  }, [chatRoom?.id, chatRoom?.creatorId, user?.uid]);

  // Galleries subscription and dynamic background selection
  // 변경: roomId 기반(galleries/{roomId})에서 캐릭터 기반(galleries/{characterId}) 병합으로 전환
  useEffect(() => {
    // 활성 캐릭터 추출
    const activeIds =
      chatRoom?.isGroupChat
        ? (chatRoom?.activeCharacterIds || [])
        : (chatRoom?.characterId ? [chatRoom.characterId] : []);

    if (!activeIds || activeIds.length === 0) {
      setGalleryItems([]);
      setSelectedBgUrl(null);
      return;
    }

    // 캐릭터 갤러리 문서들을 모두 구독하고 병합
    const unsubs: (() => void)[] = [];
    let latestItems: { url: string; weight?: number; tags?: string[] }[] = [];

    const recomputeSelection = (items: { url: string; weight?: number; tags?: string[] }[]) => {
      setGalleryItems(items);

      // User 메시지일 경우에는 배경 선택 로직을 실행하지 않음
      const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      if (!latestMessage || !latestMessage.isCharacter) {
        // 마지막 메시지가 없거나 사용자 메시지인 경우 배경 선택하지 않음
        return;
      }

      const latestText = latestMessage.text || '';
      const keywords: Record<string, string[]> = {
        sad: ['슬픔', '우울', 'sad', 'cry', '눈물'],
        happy: ['행복', '기쁨', 'happy', 'smile', '웃음'],
        anger: ['분노', '화남', 'anger', 'angry'],
        love: ['사랑', '연애', 'love', 'heart'],
      };
      const lower = latestText.toLowerCase();

      const scored = items
        .map((it: any) => {
          const base = typeof it.weight === 'number' ? it.weight : 1;
          let bonus = 0;
          const tags = Array.isArray(it.tags) ? it.tags.map((t: any) => String(t).toLowerCase()) : [];
          const match = (arr: string[]) => arr.some(k => lower.includes(k));
          if (tags.includes('sad') && match(keywords.sad)) bonus += 2;
          if (tags.includes('happy') && match(keywords.happy)) bonus += 2;
          if (tags.includes('anger') && match(keywords.anger)) bonus += 2;
          if (tags.includes('love') && match(keywords.love)) bonus += 2;
          return { ...it, _w: Math.max(0, base + bonus) };
        })
        .filter((it: any) => typeof it.url === 'string' && it.url && it._w > 0);

      if (scored.length === 0) {
        setSelectedBgUrl(null);
        return;
      }
      const total = scored.reduce((s: number, it: any) => s + it._w, 0);
      let r = Math.random() * total;
      for (const it of scored) {
        if ((r -= it._w) <= 0) {
          setSelectedBgUrl(it.url);
          return;
        }
      }
      setSelectedBgUrl(scored[scored.length - 1].url);
    };

    // 각 캐릭터 갤러리를 구독
    activeIds.forEach((cid) => {
      const gref = doc(db, 'galleries', String(cid));
      const unsub = onSnapshot(
        gref,
        (snap) => {
          // 최신 전체 병합: 모든 스냅샷을 다시 모아야 하나, 간단히 각 변경마다 병합을 재계산하기 위해
          // parallel fetch 대신 현재 활성 ID 전부를 한 번 더 getDocs로 가져오지 않고,
          // 개별 스냅샷 아이템만 바뀔 때마다 recompute를 위해 메모리 배열을 재구성한다.
          // 여기서는 단순화를 위해 각 스냅샷 이벤트마다 모든 activeIds를 getDoc하여 병합한다.
          Promise.all(activeIds.map((id) => getDoc(doc(db, 'galleries', String(id)))))
            .then((docs) => {
              latestItems = mergeCharacterGalleries(docs);
              recomputeSelection(latestItems);
            })
            .catch((err) => {
              console.error('Failed to merge character galleries:', err);
            });
        },
        (err) => {
          console.error('Failed to subscribe character gallery:', err);
        }
      );
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach((u) => {
        try { u(); } catch {}
      });
    };
  }, [chatRoom?.isGroupChat, chatRoom?.activeCharacterIds, chatRoom?.characterId, messages]);

  // Effect to initialize and update the latestSpeakerIndexRef when chatRoom state changes
  useEffect(() => {
    if (chatRoom?.nextSpeakerIndex !== undefined) {
      // Update ref only if it's different from the current state value to avoid unnecessary updates
      if (chatRoom.nextSpeakerIndex !== latestSpeakerIndexRef.current) {
        latestSpeakerIndexRef.current = chatRoom.nextSpeakerIndex;
        console.log("Updated latestSpeakerIndexRef from chatRoom state:", latestSpeakerIndexRef.current);
      }
    } else if (chatRoom && latestSpeakerIndexRef.current !== 0) {
      // Reset ref if chatRoom exists but index is undefined (e.g., single chat)
      latestSpeakerIndexRef.current = 0;
       console.log("Reset latestSpeakerIndexRef as chatRoom index is undefined");
    }
    // Initial load case (only if chatRoom exists and ref is still at default 0 but state has a different value)
    else if (chatRoom && latestSpeakerIndexRef.current === 0 && chatRoom.nextSpeakerIndex !== 0 && chatRoom.nextSpeakerIndex !== undefined) {
       latestSpeakerIndexRef.current = chatRoom.nextSpeakerIndex;
       console.log("Initialized latestSpeakerIndexRef:", latestSpeakerIndexRef.current);
    }
  }, [chatRoom]); // Depend on the chatRoom object

  // 채팅방 전환 핸들러 함수
  const handleConvertChatRoom = async (targetCharacterId?: string, reason?: string) => {
    if (!chatRoom || isConverting) return;

    setIsConverting(true);
    
    try {
      const response = await fetch('/api/chat/convert', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: chatRoom.id,
          fromType: chatRoom.isGroupChat ? 'group' : 'private',
          toType: chatRoom.isGroupChat ? 'private' : 'group',
          targetCharacterId,
          reason: reason || '사용자 요청에 의한 채팅방 전환',
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '채팅방 전환에 실패했습니다.');
      }

      const { convertedRoomId } = await response.json();
      
      // 성공 알림
      notifications.show({
        title: '채팅방 전환 완료',
        message: `${chatRoom.isGroupChat ? '개인' : '그룹'} 채팅방으로 전환되었습니다.`,
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      // 전환된 채팅방으로 리다이렉트
      if (convertedRoomId && convertedRoomId !== chatRoom.id) {
        router.push(`/chat/${convertedRoomId}`);
      } else {
        // 같은 방이라면 새로고침
        window.location.reload();
      }
      
    } catch (error) {
      console.error('채팅방 전환 오류:', error);
      notifications.show({
        title: '전환 실패',
        message: error instanceof Error ? error.message : '채팅방 전환에 실패했습니다.',
        color: 'red',
        icon: <IconX size={16} />,
      });
    } finally {
      setIsConverting(false);
      closeConversionModal();
    }
  };

  // 분기 생성 핸들러
  const handleFork = async (messageId: string, description?: string) => {
    // 🔍 DEBUG LOG: handleFork 진입점 체크
    console.log('[DEBUG] handleFork called with:', {
      messageId,
      messageIdType: typeof messageId,
      messageIdValue: messageId,
      description,
      descriptionType: typeof description,
      roomId,
      chatRoom: chatRoom ? { id: chatRoom.id, name: chatRoom.name } : 'NULL',
      loading
    });

    // 채팅방이 아직 로딩 중인 경우 사용자에게 알림
    if (loading) {
      console.warn('[WARN] handleFork: 채팅방이 아직 로딩 중입니다.');
      notifications.show({
        title: '잠시만 기다려주세요',
        message: '채팅방이 아직 로딩 중입니다. 잠시 후 다시 시도해주세요.',
        color: 'yellow',
      });
      return;
    }

    // chatRoom이 로딩 완료되었지만 null인 경우
    if (!chatRoom) {
      const errorMsg = '채팅방 정보를 불러올 수 없습니다.';
      console.error('[ERROR] handleFork: chatRoom이 null입니다.', {
        roomId: !!roomId,
        chatRoom: !!chatRoom,
        loading
      });
      notifications.show({
        title: '오류',
        message: errorMsg,
        color: 'red',
      });
      return;
    }

    if (!roomId) {
      const errorMsg = '채팅방 ID가 유효하지 않습니다.';
      console.error('[ERROR] handleFork: roomId가 누락되었습니다.', { roomId });
      notifications.show({
        title: '오류',
        message: errorMsg,
        color: 'red',
      });
      return;
    }

    // 🔍 DEBUG LOG: 매개변수 유효성 재확인
    if (!messageId) {
      console.error('[ERROR] handleFork: messageId가 누락되었습니다.', { messageId });
      notifications.show({
        title: '오류',
        message: '분기할 메시지를 선택해주세요.',
        color: 'red',
      });
      return;
    }

    try {
      // 🔍 DEBUG LOG: API 요청 전 원본 데이터 확인
      console.log('[DEBUG] Fork API request preparation:', {
        rawRoomId: roomId,
        rawRoomIdType: typeof roomId,
        rawMessageId: messageId,
        rawMessageIdType: typeof messageId,
        rawDescription: description,
        rawDescriptionType: typeof description
      });

      const requestBody = {
        originalRoomId: String(roomId), // ✅ 서버가 기대하는 필드명
        forkFromMessageId: messageId, // ✅ 서버가 기대하는 필드명
        forkDescription: description || '분기점에서 새로운 대화', // ✅ 서버가 기대하는 필드명
      };
      
      // 🔍 DEBUG LOG: API 요청 데이터 최종 확인
      console.log('[DEBUG] Fork API request final body:', {
        requestBody,
        stringifiedBody: JSON.stringify(requestBody),
        originalRoomId: requestBody.originalRoomId,
        originalRoomIdType: typeof requestBody.originalRoomId,
        forkFromMessageId: requestBody.forkFromMessageId,
        forkFromMessageIdType: typeof requestBody.forkFromMessageId,
        forkDescription: requestBody.forkDescription,
        forkDescriptionType: typeof requestBody.forkDescription
      });
      
      const response = await fetch('/api/chat/fork', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '분기 생성에 실패했습니다.');
      }

      const { forkId } = await response.json();
      
      notifications.show({
        title: '분기 생성 완료',
        message: '새로운 분기가 생성되었습니다.',
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      // 생성된 분기로 이동
      if (forkId) {
        router.push(`/chat/${forkId}`);
      }
      
    } catch (error) {
      console.error('분기 생성 오류:', error);
      notifications.show({
        title: '분기 생성 실패',
        message: error instanceof Error ? error.message : '분기 생성에 실패했습니다.',
        color: 'red',
        icon: <IconX size={16} />,
      });
      throw error; // MessageList에서 catch할 수 있도록 re-throw
    }
  };

  // 채팅방 설정 저장 핸들러
  const handleSaveChatRoomSettings = async (settings: { autoConvertToPrivate: boolean }) => {
    if (!chatRoom) return;

    try {
      const roomRef = doc(db, 'chatRooms', chatRoom.id);
      await updateDoc(roomRef, {
        autoConvertToPrivate: settings.autoConvertToPrivate,
        updatedAt: serverTimestamp(),
      });

      notifications.show({
        title: '설정 저장 완료',
        message: '채팅방 설정이 저장되었습니다.',
        color: 'green',
        icon: <IconCheck size={16} />,
      });

      closeChatRoomSettingsModal();
    } catch (error) {
      console.error('채팅방 설정 저장 오류:', error);
      notifications.show({
        title: '설정 저장 실패',
        message: '채팅방 설정 저장에 실패했습니다.',
        color: 'red',
        icon: <IconX size={16} />,
      });
    }
  };

  // 실시간 캐릭터 수 감지 및 자동 전환 로직
  useEffect(() => {
    if (!chatRoom || !chatRoom.activeCharacterIds) return;

    const activeCount = chatRoom.activeCharacterIds.length;
    
    // 그룹 채팅방에서 캐릭터가 1명만 남았을 때
    if (chatRoom.isGroupChat && activeCount === 1 && chatRoom.autoConvertToPrivate) {
      // 자동 전환 로직
      const remainingCharacterId = chatRoom.activeCharacterIds[0];
      setConversionSettings({
        fromType: 'group',
        toType: 'private',
        auto: true
      });
      
      // 자동 전환 실행
      handleConvertChatRoom(remainingCharacterId, '캐릭터가 1명만 남아서 자동으로 개인 채팅방으로 전환됨');
    }
    
    // 개인 채팅방에서 캐릭터가 2명 이상일 때 그룹 전환 제안
    if (!chatRoom.isGroupChat && activeCount >= 2) {
      notifications.show({
        title: '그룹 채팅방 전환 제안',
        message: '활성 캐릭터가 2명 이상입니다. 그룹 채팅방으로 전환하시겠습니까?',
        color: 'blue',
        icon: <IconUsers size={16} />,
        autoClose: 5000,
      });
    }
  }, [chatRoom?.activeCharacterIds, chatRoom?.isGroupChat, chatRoom?.autoConvertToPrivate, chatRoom, handleConvertChatRoom]);

  // 초기 로드 완료 후 자동으로 맨 아래로 스크롤 (지연 적용)
  useEffect(() => {
    if (!loading && scrollAreaRef.current) {
      // 기존 타이머가 있으면 취소
      if (initialScrollTimeoutRef.current) {
        clearTimeout(initialScrollTimeoutRef.current as any);
        initialScrollTimeoutRef.current = null;
      }
      initialScrollTimeoutRef.current = setTimeout(() => {
        const el = scrollAreaRef.current!;
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      }, SCROLL_DELAY_MS);
    }
    return () => {
      if (initialScrollTimeoutRef.current) {
        clearTimeout(initialScrollTimeoutRef.current as any);
        initialScrollTimeoutRef.current = null;
      }
    };
  }, [loading]);
  

  // Scroll to bottom only for initial load or when new messages arrive (지연 적용)
  useEffect(() => {
    // infinite scroll으로 이전 메시지 로드 시 스크롤 유지 (스크롤하지 않음)
    if (prevIsLoadingMoreRef.current) {
      // 이전 로딩 마무리: 스크롤 동작 건너뜀
    } else if (messages.length > prevMessagesLengthRef.current) {
      // 초기 로드 혹은 새 메시지 도착 시 맨 아래로 스크롤 (지연)
      if (messageScrollTimeoutRef.current) {
        clearTimeout(messageScrollTimeoutRef.current as any);
        messageScrollTimeoutRef.current = null;
      }
      messageScrollTimeoutRef.current = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, SCROLL_DELAY_MS);
    }
    // refs 업데이트
    prevMessagesLengthRef.current = messages.length;
    prevIsLoadingMoreRef.current = isLoadingMore;

    return () => {
      if (messageScrollTimeoutRef.current) {
        clearTimeout(messageScrollTimeoutRef.current as any);
        messageScrollTimeoutRef.current = null;
      }
    };
  }, [messages, isLoadingMore]);

 // --- Helper Functions ---

// 정규 표현식 특수 문자 이스케이프 함수
const escapeRegExp = (string: string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $&는 일치한 전체 문자열을 의미
};

 // 파일 다운로드 헬퍼 함수 (chat/page.tsx와 동일)
 const downloadTxtFile = (filename: string, text: string) => {
   const element = document.createElement('a');
   const file = new Blob([text], { type: 'text/plain;charset=utf-8' });
   element.href = URL.createObjectURL(file);
   element.download = `${filename}.txt`;
   document.body.appendChild(element); // Required for this to work in FireFox
   element.click();
   document.body.removeChild(element);
 };

 // 현재 채팅방 내보내기 함수
 const handleExportCurrentRoom = async () => {
   if (!chatRoom || !user || !roomId) return;

   setExportLoading(true);
   try {
     let chatContent = `채팅방: ${chatRoom.name}\n`;
     chatContent += `설명: ${chatRoom.description || '없음'}\n`;
     if (chatRoom.isGroupChat && chatRoom.characters) {
       chatContent += `참여 캐릭터: ${chatRoom.characters.map(c => c.name).join(', ')}\n`;
     } else if (chatRoom.character) {
       chatContent += `캐릭터: ${chatRoom.character.name}\n`;
     }
     chatContent += `생성자: ${chatRoom.creatorName}\n`;
     chatContent += `--------------------\n\n`;

     // 전체 메시지를 Firestore에서 시간순으로 가져와 내보내기 (state의 일부 페이지만 사용하는 문제가 있었음)
     const messagesRef = collection(db, 'chatRooms', String(roomId), 'messages');
     const q = query(messagesRef, orderBy('timestamp', 'asc'));
     const snapshot = await getDocs(q);

     snapshot.forEach((docSnap) => {
       const msg = docSnap.data() as any;
       const messageText = msg.text || '';
       const cleanedText = renderTextWithFormatting(messageText);

       // 사용자 메시지 포함 여부 확인
       if (msg.senderId === user.uid && !includeUserMessages) {
         return;
       }

       // 본문
       chatContent += `${cleanedText}\n`;
     });

     // 파일 다운로드 (채팅방 이름으로 파일명 지정)
     const filename = chatRoom.name.replace(/[^a-z0-9ㄱ-ㅎㅏ-ㅣ가-힣]/gi, '_'); // 파일명 유효 문자 처리
     downloadTxtFile(filename || `chat_${roomId}`, chatContent);

     notifications.show({
       title: '내보내기 완료',
       message: `채팅 내용이 ${filename || `chat_${roomId}`}.txt 파일로 저장되었습니다.`,
       color: 'green',
       icon: <IconDownload size={16} />,
     });
   } catch (error) {
     console.error('Error exporting current chat room:', error);
     notifications.show({
       title: '내보내기 실패',
       message: '채팅 내용을 내보내는 중 오류가 발생했습니다.',
       color: 'red',
     });
   } finally {
     setExportLoading(false);
     closeExportModal();
   }
 };

   // Handle image upload selection (opening the file dialog)
   const handleImageSelect = () => {
     fileInputRef.current?.click();
   };

   // Handle file input change and upload immediately
   const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
     const file = event.target.files?.[0];
     if (file && roomId) {
       const maxSize = 30 * 1024 * 1024; // 30MB
       if (file.size > maxSize) {
         notifications.show({
           title: '업로드 용량 초과',
           message: '이미지 파일은 30MB를 초과할 수 없습니다.',
           color: 'red',
         });
         setImageUpload(null);
         setImagePreview(null);
         if (fileInputRef.current) {
           fileInputRef.current.value = '';
         }
         return;
       }
 
       setImageUpload(file); // Keep the file object if needed for other purposes
       setIsUploadingImage(true); // Show loading indicator
       setImagePreview(URL.createObjectURL(file)); // Optimistic local preview
 
       try {
         const storageRef = ref(storage, `chatImages/${roomId}/${uuidv4()}`);
         await uploadBytes(storageRef, file);
         const downloadURL = await getDownloadURL(storageRef);
         
         // Set the uploaded URL as the preview to be sent with the message
         setImagePreview(downloadURL);
         console.log("Image uploaded and URL set for sending:", downloadURL);
         notifications.show({
            title: '업로드 완료',
            message: '이미지가 성공적으로 업로드되었습니다. 메시지와 함께 전송할 수 있습니다.',
            color: 'green',
         });
 
       } catch (error) {
         console.error("Error uploading image:", error);
         notifications.show({
           title: '이미지 업로드 실패',
           message: '이미지를 업로드하는 중 오류가 발생했습니다.',
           color: 'red',
         });
         setImagePreview(null); // Clear preview on error
       } finally {
         setIsUploadingImage(false); // Hide loading indicator
       }
     } else {
       setImageUpload(null);
       setImagePreview(null);
     }
   };

  // --- Function to handle persona selection ---
  const handleSetSelectedPersonaId = async (id: string | null) => {
    setSelectedPersonaIdState(id); // Update local state immediately

    if (user) {
      const userDocRef = doc(db, 'users', user.uid);
      try {
        if (id) {
          await updateDoc(userDocRef, { selectedPersonaId: id });
          // Fetch and update persona image/name for immediate UI feedback
          const persona = userPersonas.find(p => p.id === id);
          setPersonaCharacterImage(persona?.image || null);
          setPersonaName(persona?.name || null);
        } else {
          // If clearing persona, remove the field from Firestore
          await updateDoc(userDocRef, { selectedPersonaId: deleteField() });
          setPersonaCharacterImage(null); // Clear local image/name
          setPersonaName(null);
        }
      } catch (error) {
        console.error("Error updating selected persona in Firestore:", error);
        notifications.show({
          title: '페르소나 저장 실패',
          message: '선택한 페르소나를 저장하는 중 오류가 발생했습니다.',
          color: 'red',
        });
        // Optionally revert local state if DB update fails?
        // setSelectedPersonaIdState(previousValue); // Need to store previous value
      }
    }
  };

  // Send message
  const sendMessage = async (text: string, imageUrl?: string | null) => {
    if ((!text.trim() && !imageUrl) || !user || !roomId || !chatRoom) return;

    setSendingMessage(true); // Start sending process

    let userMessageDocId: string | null = null; // Store the user message doc ID
    console.log("Sending message with text:", text, "and imageUrl:", imageUrl);

    try {
      // Image is already uploaded in handleFileChange. `imageUrl` now holds the Firebase Storage URL.
      const uploadedImageUrl = imageUrl || '';

      // --- Determine sender info ---
      let finalSenderName = user.displayName || '사용자';
      let finalSenderAvatar = user.photoURL || '';
      if (selectedPersonaId) {
        const persona = userPersonas.find(p => p.id === selectedPersonaId);
        if (persona) {
          finalSenderName = persona.name;
          finalSenderAvatar = persona.image || '';
        } else {
          console.warn(`Selected persona ${selectedPersonaId} not found.`);
        }
      }

      // --- Prepare user message data ---
      const userMessageData: Omit<Message, 'id' | 'timestamp'> = {
        senderId: user.uid,
        senderName: finalSenderName,
        senderAvatar: finalSenderAvatar,
        isCharacter: false,
        characterId: '',
        text: text.trim() || '(이미지)', // Add placeholder if text is empty but image exists
        imageUrl: uploadedImageUrl || '',
      };

      // --- Add user message to Firestore ---
      const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
      const userMessageDocRef = await addDoc(messagesColRef, {
        ...userMessageData,
        timestamp: serverTimestamp()
      });
      userMessageDocId = userMessageDocRef.id; // Store the ID

      // Fire-and-forget vector indexing for user message
      try {
        const payload = {
          roomId: String(roomId),
          messageId: userMessageDocRef.id,
          role: 'user' as const,
          content: (text && text.trim()) ? text.trim() : '(이미지)',
          characterId: null,
          userId: user.uid,
          createdAt: Date.now(),
        };
        void fetch('/api/vector/index-message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch((e) => console.error('[vector-index] failed', e));
      } catch (e) {
        console.warn('[vector-index] user message index enqueue failed', e);
      }

      // --- Clear input and reset sending state IMMEDIATELY after adding user message ---
      const messageTextSent = text.trim(); // Store the text before clearing
      const currentSelectedPersonaId = selectedPersonaId; // Store current persona ID before clearing
      setNewMessage('');
      setImageUpload(null);
      setImagePreview(null);
      setSendingMessage(false); // <<< ALLOW USER TO TYPE NEXT MESSAGE

      // --- Image generation logic removed from sendMessage ---
      // Image generation will now happen after bot response in generateBotResponses

      // --- Update chat room metadata (last message, timestamp) ---
      // This can happen in the background, no need to await here for user input unlock
      const roomDocRef = doc(db, 'chatRooms', String(roomId));
      updateDoc(roomDocRef, {
        lastMessage: messageTextSent || '(이미지)', // Use the stored text or placeholder
        lastUpdated: serverTimestamp(),
      }).catch(err => console.error("Error updating room metadata:", err)); // Log error if update fails

      // --- Trigger bot response generation asynchronously ---
      // Fetch the latest messages including the one just sent
      const messagesQuery = query(messagesColRef, orderBy('timestamp', 'asc'));
      const querySnapshot = await getDocs(messagesQuery);
      const latestMessages: Message[] = [];
      querySnapshot.forEach((doc) => {
          const data = doc.data();
          const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date();
          // 명시적으로 필요한 필드를 모두 추출하여 Message 객체 생성
          latestMessages.push({
            id: doc.id,
            senderId: data.senderId,
            senderName: data.senderName,
            senderAvatar: data.senderAvatar || '',
            isCharacter: data.isCharacter || false,
            characterId: data.characterId || '',
            text: data.text,
            imageUrl: userMessageData.imageUrl || data.imageUrl || '',
            generatedImageUrl: data.generatedImageUrl || undefined,
            imageGenPrompt: data.imageGenPrompt || undefined,
            imageError: data.imageError || false,
            timestamp,
            imageData: data.imageData,
          } as Message);
      });

      // Call the generation function without awaiting it
      generateBotResponses(latestMessages, userMessageData); // No need to pass the file object anymore

    } catch (error) {
      console.error('Error sending user message or uploading image:', error);
      notifications.show({
        title: '메시지 전송 실패',
        message: '메시지를 보내는 중 오류가 발생했습니다.',
        color: 'red',
      });
      // Ensure sending state is reset even on error
      setSendingMessage(false);
      setIsUploadingImage(false); // Also reset image upload indicator
      // Optionally remove the optimistically added user message if needed (though listener handles state)
      // if (userMessageDocId) {
      //   try {
      //     await deleteDoc(doc(db, 'chatRooms', String(roomId), 'messages', userMessageDocId));
      //   } catch (deleteError) {
      //     console.error("Error deleting failed user message:", deleteError);
      //   }
      // }
    }
    // No finally block needed for setSendingMessage(false) as it's handled above
  };

  // --- New function to handle bot response generation asynchronously ---
  const generateBotResponses = async (contextMessages: Message[], userMessage: Omit<Message, 'id' | 'timestamp'>) => {
    if (!user || !roomId) return; // Removed chatRoom dependency here, will fetch inside

    // Re-fetch chatRoom data to ensure we have the latest state, especially nextSpeakerIndex
    let currentChatRoom: ChatRoom | null = null;
    const roomDocRef = doc(db, 'chatRooms', String(roomId));
    try {
        const roomSnap = await getDoc(roomDocRef);
        if (roomSnap.exists()) {
            const roomData = roomSnap.data();
            // Reconstruct a minimal ChatRoom object needed for this function
            // Fetch characters data associated with the room
            let charactersData: Character[] = [];
            const characterIdsToFetch = roomData.characterIds || (roomData.characterId ? [roomData.characterId] : []);
            if (characterIdsToFetch.length > 0) {
                const charDocs = await Promise.all(
                    characterIdsToFetch.map((id: string) => getDoc(doc(db, 'characters', id)))
                );
                charactersData = charDocs
                    .filter(d => d.exists())
                    .map(d => ({ id: d.id, ...d.data() } as Character));
            }

            currentChatRoom = {
                id: roomSnap.id,
                name: roomData.name,
                isGroupChat: roomData.isGroupChat || false,
                characterId: roomData.characterId,
                characterIds: roomData.characterIds || [],
                activeCharacterIds: roomData.activeCharacterIds || (roomData.isGroupChat ? roomData.characterIds || [] : []),
                nextSpeakerIndex: roomData.nextSpeakerIndex !== undefined ? roomData.nextSpeakerIndex : (roomData.isGroupChat ? 0 : -1),
                isNSFW: roomData.isNSFW || false,
                lorebookIds: roomData.lorebookIds || [],
                characters: charactersData, // Use fetched characters data
                creatorId: roomData.creatorId,
                creatorName: roomData.creatorName,
                description: roomData.description,
                image: roomData.image,
                lastUpdated: roomData.lastUpdated?.toDate(),
                members: roomData.members || 0,
                tags: roomData.tags || [],
            };
        } else {
            console.error("Chat room document not found during bot response generation.");
            return;
        }
    } catch (fetchError) {
        console.error("Error re-fetching chat room data:", fetchError);
        return; // Stop if we can't get the latest room state
    }

    // Ensure currentChatRoom is not null after fetching
    if (!currentChatRoom) {
        console.error("Failed to load current chat room state.");
        return;
    }


    const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
    const botMessagesBatch: Message[] = []; // To track generated messages for metadata update
    let finalNextSpeakerIndex = currentChatRoom.nextSpeakerIndex ?? 0;
    const accumulatedMessages = [...contextMessages]; // Start with the provided context

    try {
        if (currentChatRoom.isGroupChat && currentChatRoom.activeCharacterIds && currentChatRoom.activeCharacterIds.length > 0) {
            // --- Group Chat Logic ---
            const activeChars = currentChatRoom.activeCharacterIds;
            const numActive = activeChars.length;
            let currentSpeakerIndex = currentChatRoom.nextSpeakerIndex ?? 0;
            if (currentSpeakerIndex < 0 || currentSpeakerIndex >= numActive) {
                currentSpeakerIndex = 0;
            }

            for (let i = 0; i < numActive; i++) {
                const speakerIndex = (currentSpeakerIndex + i) % numActive;
                const characterId = activeChars[speakerIndex];
                // Use characters from the re-fetched room data
                const character = currentChatRoom.characters?.find(char => char.id === characterId);
                if (!character) {
                    console.warn(`Character data not found for ID ${characterId} in group chat response generation.`);
                    continue;
                };

                const typingIndicatorId = `typing-${characterId}-${uuidv4()}`; // Unique ID for typing indicator
                let botMessageDocRefId: string | null = null;

                try {
                    // Add typing indicator message to Firestore
                    const typingMessageData = {
                        senderId: 'bot',
                        senderName: character.name,
                        senderAvatar: character.image || '',
                        isCharacter: true,
                        characterId: characterId,
                        text: '입력 중...',
                        imageUrl: '',
                        generatedImageUrl: null, // undefined 대신 null 사용
                        imageGenPrompt: null, // undefined 대신 null 사용
                        imageError: false,
                        timestamp: serverTimestamp(),
                        isLoading: true // Add isLoading flag
                    };
                    const typingDocRef = await addDoc(messagesColRef, typingMessageData);
                    botMessageDocRefId = typingDocRef.id; // Store ID to update/delete later

                    console.log(`msg-${character.name} typing indicator added with ID: ${accumulatedMessages.map(msg => `text: ${msg.text}, imageUrl: ${msg.imageUrl}`).join(', ')}`);

                    // Make API call with JSON, as image is now a URL
                    const lastMessageObject = accumulatedMessages[accumulatedMessages.length - 1];
                    const response = await fetch('/api/chat/bot-response', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            roomId: String(roomId),
                            characterId: characterId,
                            characterName: character.name,
                            characterInfo: character.detail || character.description,
                            senseiName: user.displayName || '선생님',
                            lastMessage: lastMessageObject.text,
                            imageUrl: lastMessageObject.imageUrl, // This now contains the Firebase Storage URL
                            isNSFW: currentChatRoom.isNSFW,
                            enableNSFW: settings.enableNSFW,
                            isBanmal: character.isBanmal,
                            userId: uid,
                            lorebookIds: currentChatRoom.lorebookIds || [],
                        }),
                    });

                    // if (!response.ok) {
                    //     const errorBody = await response.text();
                    //     console.error(`API Error for ${character.name}:`, errorBody);
                    //     // Update the typing message to show an error state instead of deleting
                    //     if (botMessageDocRefId) {
                    //         await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                    //             text: `(${character.name} 응답 오류)`,
                    //             isLoading: false // Mark as not loading anymore
                    //         });
                    //     }
                    //     continue; // Move to next character
                    // }

                    const botResponseData = await response.json();
                    const botResponseText = botResponseData.response || `(${character.name} 응답 생성 오류)`;
                    const botEmotion = typeof botResponseData.emotion === 'string' ? botResponseData.emotion : undefined;

                    // Update the typing message with the actual response
                    const botMessageData = {
                        text: botResponseText,
                        emotion: botEmotion,
                        isLoading: false, // Mark as not loading
                        isFinal: true, // 메시지 확정
                        timestamp: serverTimestamp() // Update timestamp
                    };
                     if (botMessageDocRefId) {
                        await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), botMessageData);

                        // Fire-and-forget vector indexing for assistant message (group)
                        try {
                          const payload = {
                            roomId: String(roomId),
                            messageId: botMessageDocRefId,
                            role: 'assistant' as const,
                            content: botResponseText,
                            characterId: characterId,
                            userId: null,
                            createdAt: Date.now(),
                          };
                          void fetch('/api/vector/index-message', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                            keepalive: true,
                          }).catch((e) => console.error('[vector-index] failed', e));
                        } catch (e) {
                          console.warn('[vector-index] assistant message index enqueue failed (group)', e);
                        }

                        // --- Trigger Image Generation for this Bot Message (async) ---
                        if (settings.enableImageGeneration && botResponseText && !botResponseText.includes("응답 오류")) {
                          console.log(`Image generation userId: ${uid}, character: ${character.name}, roomId: ${roomId}, botMessageDocRefId: ${botMessageDocRefId}`);
                          const currentUserPersona = selectedPersonaId ? userPersonas.find(p => p.id === selectedPersonaId) : null;
                          const imageGenContext = {
                            character: character, // The character who just responded
                            userPersona: currentUserPersona, // Current user persona
                            messageText: botResponseText, // The bot's response text
                            roomId: String(roomId),
                            isRoomNSFW: currentChatRoom.isNSFW,
                            userId: uid,
                          };                          

                          fetch('/api/generate-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(imageGenContext),
                          })
                          .then(res => res.ok ? res.json() : Promise.reject(res))
                          .then(data => {
                            if (data.imageUrl && botMessageDocRefId) {
                              // Update the bot message document with the generated image URL and prompt
                              const updateData: { generatedImageUrl: string; imageGenPrompt?: string, isFinal: boolean } = {
                                  generatedImageUrl: data.imageUrl,
                                  isFinal: true, // 이미지 생성 완료 후에도 확정
                                };
                              if (data.imageGenPrompt) {
                                updateData.imageGenPrompt = data.imageGenPrompt;
                              } else if (data.generatedPrompt) {
                                updateData.imageGenPrompt = data.generatedPrompt;
                              }
                              updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), updateData)
                              .catch(updateError => {
                                console.error(`Error updating bot message ${botMessageDocRefId} with generated image URL and prompt:`, updateError);
                              });
                            }
                          })
                          .catch(async (error) => {
                            let errorMsg = 'Unknown error';
                            try {
                                if (error instanceof Response) {
                                    errorMsg = await error.text();
                                } else if (error instanceof Error) {
                                    errorMsg = error.message;
                                }
                            } catch (e) { /* ignore */ }
                            console.error(`Error calling image generation API for ${character.name}:`, errorMsg);
                            // 이미지 생성 실패 시 Firestore 문서 업데이트
                            if (botMessageDocRefId) {
                              try {
                                await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                                  imageError: true,
                                  generatedImageUrl: null,
                                });
                              } catch (updateError) {
                                console.error(`Error updating message ${botMessageDocRefId} with imageError:`, updateError);
                              }
                            }
                            // Optionally show notification for image generation failure
                            // notifications.show({ title: '이미지 생성 실패', message: `${character.name} 응답 이미지 생성 오류`, color: 'orange' });
                          });
                        }
                        // --- End Image Generation ---

                     } else {
                         console.error("botMessageDocRefId is null, cannot update message for", character.name);
                         continue; // Skip if we lost the reference
                     }


                    // Prepare data for batch and context update (using the final data)
                    const finalBotMessage: Message = {
                        id: botMessageDocRefId,
                        senderId: 'bot',
                        senderName: character.name,
                        senderAvatar: character.image || '',
                        isCharacter: true,
                        characterId: characterId,
                        text: botResponseText,
                        emotion: botEmotion,
                        imageUrl: '',
                        generatedImageUrl: null, // undefined 대신 null 사용
                        imageGenPrompt: null, // undefined 대신 null 사용
                        imageError: false,
                        timestamp: new Date(), // Use approximate timestamp for local context
                    };
                    botMessagesBatch.push(finalBotMessage);
                    // 명시적으로 필요한 필드를 모두 추출하여 Message 객체 생성
                    accumulatedMessages.push({
                      id: finalBotMessage.id,
                      senderId: finalBotMessage.senderId,
                      senderName: finalBotMessage.senderName,
                      senderAvatar: finalBotMessage.senderAvatar,
                      isCharacter: finalBotMessage.isCharacter,
                      characterId: finalBotMessage.characterId,
                      text: finalBotMessage.text,
                      imageUrl: finalBotMessage.imageUrl,
                      generatedImageUrl: finalBotMessage.generatedImageUrl,
                      imageGenPrompt: finalBotMessage.imageGenPrompt,
                      imageError: finalBotMessage.imageError,
                      timestamp: finalBotMessage.timestamp
                    }); // Add to context for next iteration

                } catch (error) {
                    console.error(`Error getting bot response for ${character.name}:`, error);
                    if (botMessageDocRefId) {
                        // Update the typing message to show an error state
                         try {
                            await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                                text: `(${character.name} 응답 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'})`,
                                isLoading: false
                            });
                        } catch (updateError) {
                             console.error("Error updating message to error state:", updateError);
                        }
                    }
                    notifications.show({
                        title: `${character.name} 응답 오류`,
                        message: `캐릭터 응답 생성 중 오류: ${error instanceof Error ? error.message : String(error)}`,
                        color: 'red',
                    });
                }
            }
            finalNextSpeakerIndex = currentSpeakerIndex; // Next turn starts from the same index

        } else if (currentChatRoom.characterId && currentChatRoom.characters) { // Check characters array existence
            // --- Single Chat Logic ---
             // Find the character data from the potentially updated characters list
            const character = currentChatRoom.characters.find(c => c.id === currentChatRoom.characterId);

            if (!character) {
                 console.error("Character data not found for single chat response generation.");
                 notifications.show({ title: '오류', message: '단일 채팅 캐릭터 정보를 찾을 수 없습니다.', color: 'red' });
                 return;
            }

            const characterId = currentChatRoom.characterId;
            const charInfo = character.detail || character.description;


            if (!charInfo) {
                console.error("Character info missing for single chat.");
                notifications.show({ title: '오류', message: '캐릭터 정보 누락', color: 'red' });
                return;
            }

            const typingIndicatorId = `typing-${characterId}-${uuidv4()}`;
            let botMessageDocRefId: string | null = null;

            try {
                // Add typing indicator message
                const typingMessageData = {
                    senderId: 'bot',
                    senderName: character.name,
                    senderAvatar: character.image || '',
                    isCharacter: true,
                    characterId: characterId,
                    text: '입력 중...',
                    imageUrl: '',
                    generatedImageUrl: null, // undefined 대신 null 사용
                    imageGenPrompt: null, // undefined 대신 null 사용
                    imageError: false,
                    timestamp: serverTimestamp(),
                    isLoading: true
                };
                const typingDocRef = await addDoc(messagesColRef, typingMessageData);
                botMessageDocRefId = typingDocRef.id;

                // API Call
                const lastMessageObject = accumulatedMessages[accumulatedMessages.length - 1];
                const response = await fetch('/api/chat/bot-response', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        roomId: String(roomId),
                        characterId: characterId,
                        characterName: character.name,
                        characterInfo: charInfo,
                        senseiName: user.displayName || '선생님',
                        lastMessage: lastMessageObject.text,
                        imageUrl: lastMessageObject.imageUrl, // This now contains the Firebase Storage URL
                        isNSFW: currentChatRoom.isNSFW,
                        enableNSFW: settings.enableNSFW,
                        isBanmal: character.isBanmal,
                        userId: uid,
                        lorebookIds: currentChatRoom.lorebookIds || [],
                    }),
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    console.error("API Error (Single Chat):", errorBody);
                     if (botMessageDocRefId) {
                        await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                            text: `(응답 오류)`,
                            isLoading: false
                        });
                     }
                    throw new Error(`Failed to get bot response: ${response.statusText}`);
                }

                const botResponseData = await response.json();
                const botResponseText = botResponseData.response || '응답 생성 오류';
                const botEmotion = typeof botResponseData.emotion === 'string' ? botResponseData.emotion : undefined;

                // Update typing message with response
                 const botMessageData = {
                    text: botResponseText,
                    emotion: botEmotion,
                    isLoading: false,
                    isFinal: true, // 메시지 확정
                    timestamp: serverTimestamp()
                };
                 if (botMessageDocRefId) {
                    await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), botMessageData);

                    // --- Trigger Image Generation for this Bot Message (async) ---
                    if (settings.enableImageGeneration && botResponseText && !botResponseText.includes("응답 오류")) {
                      const currentUserPersona = selectedPersonaId ? userPersonas.find(p => p.id === selectedPersonaId) : null;
                      const imageGenContext = {
                        character: character, // The character who just responded
                        userPersona: currentUserPersona, // Current user persona
                        messageText: botResponseText, // The bot's response text
                        roomId: String(roomId),
                        isRoomNSFW: currentChatRoom.isNSFW,
                        userId: uid,
                      };
                      console.log(`Image generation userId: ${uid}, character: ${character.name}, roomId: ${roomId}, botMessageDocRefId: ${botMessageDocRefId}`);

                      fetch('/api/generate-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(imageGenContext),
                      })
                      .then(res => res.ok ? res.json() : Promise.reject(res))
                      .then(data => {
                        if (data.imageUrl && botMessageDocRefId) {
                          // Update the bot message document with the generated image URL and prompt
                          const updateData: { generatedImageUrl: string; imageGenPrompt?: string, isFinal: boolean } = {
                            generatedImageUrl: data.imageUrl,
                            isFinal: true, // 이미지 생성 완료 후에도 확정
                          };
                          if (data.imageGenPrompt) {
                            updateData.imageGenPrompt = data.imageGenPrompt;
                          } else if (data.generatedPrompt) {
                            updateData.imageGenPrompt = data.generatedPrompt;
                          }
                          updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), updateData)
                          .catch(updateError => {
                            console.error(`Error updating bot message ${botMessageDocRefId} with generated image URL and prompt (single chat):`, updateError);
                          });
                        }
                      })
                      .catch(async (error) => {
                        let errorMsg = 'Unknown error';
                        try {
                            if (error instanceof Response) {
                                errorMsg = await error.text();
                            } else if (error instanceof Error) {
                                errorMsg = error.message;
                            }
                        } catch (e) { /* ignore */ }
                        console.error(`Error calling image generation API for ${character.name} (single chat):`, errorMsg);
                        // 이미지 생성 실패 시 Firestore 문서 업데이트
                        if (botMessageDocRefId) {
                          try {
                            await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                              imageError: true,
                              generatedImageUrl: null,
                            });
                          } catch (updateError) {
                            console.error(`Error updating message ${botMessageDocRefId} with imageError (single chat):`, updateError);
                          }
                        }
                        // Optionally show notification
                      });
                    }
                    // --- End Image Generation ---

                 } else {
                     console.error("botMessageDocRefId is null, cannot update message for single chat");
                     throw new Error("Lost message reference during single chat response"); // Throw to prevent metadata update with wrong info
                 }


                // Prepare data for batch update
                const finalBotMessage: Message = {
                    id: botMessageDocRefId,
                    senderId: 'bot',
                    senderName: character.name,
                    senderAvatar: character.image || '',
                    isCharacter: true,
                    characterId: characterId,
                    text: botResponseText,
                    emotion: botEmotion,
                    imageUrl: '',
                    generatedImageUrl: null, // undefined 대신 null 사용
                    imageGenPrompt: null, // undefined 대신 null 사용
                    imageError: false,
                    timestamp: new Date(),
                };
                botMessagesBatch.push(finalBotMessage);

            } catch (error) {
                console.error('Error getting bot response (single chat):', error);
                 if (botMessageDocRefId) {
                    try {
                        await updateDoc(doc(db, 'chatRooms', String(roomId), 'messages', botMessageDocRefId), {
                            text: `(응답 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'})`,
                            isLoading: false
                        });
                    } catch (updateError) {
                        console.error("Error updating message to error state (single):", updateError);
                    }
                }
                notifications.show({ title: '봇 응답 오류', message: `캐릭터 응답 생성 중 오류: ${error instanceof Error ? error.message : String(error)}`, color: 'red' });
            }
            finalNextSpeakerIndex = -1; // Single chat doesn't use index
        }

        // --- Update Firestore metadata (last message, speaker index) after all responses ---
        if (botMessagesBatch.length > 0) {
            try {
                // Find the last *successfully* generated message text
                const lastSuccessfulMessage = botMessagesBatch.slice().reverse().find(msg => !msg.text.includes("응답 오류"));
                const lastMessageText = lastSuccessfulMessage ? lastSuccessfulMessage.text : (accumulatedMessages.length > 0 ? accumulatedMessages[accumulatedMessages.length - 1].text : "채팅 업데이트됨"); // Fallback if all bots failed

                await updateDoc(roomDocRef, {
                    lastMessage: lastMessageText,
                    lastUpdated: serverTimestamp(),
                    nextSpeakerIndex: finalNextSpeakerIndex,
                });
                // No need to update local state here, listener will catch it.
                // setChatRoom(prev => prev ? { ...prev, nextSpeakerIndex: finalNextSpeakerIndex } : null);
                // latestSpeakerIndexRef.current = finalNextSpeakerIndex; // Ref update might be needed if other logic depends on it immediately
            } catch (updateError) {
                console.error("Error updating Firestore metadata after bot responses:", updateError);
                notifications.show({ title: '메타데이터 업데이트 오류', message: '채팅방 정보 업데이트 중 오류 발생', color: 'red' });
            }
        } else if (currentChatRoom.isGroupChat) { // Only update index if it's a group chat and no bot messages were generated successfully
             try {
                 await updateDoc(roomDocRef, { nextSpeakerIndex: finalNextSpeakerIndex });
                 // No need to update local state here.
                 // setChatRoom(prev => prev ? { ...prev, nextSpeakerIndex: finalNextSpeakerIndex } : null);
                 // latestSpeakerIndexRef.current = finalNextSpeakerIndex;
             } catch (indexUpdateError) {
                 console.error("Error updating speaker index when no bot messages were sent:", indexUpdateError);
             }
        }

    } catch (outerError) {
        // Catch errors from fetching context messages or initial setup
        console.error("Error in generateBotResponses outer scope:", outerError);
        notifications.show({ title: '봇 응답 생성 오류', message: '봇 응답을 준비하는 중 오류가 발생했습니다.', color: 'red' });
    }
  };

  // --- End New function ---

  // Handle message edit
  const handleEditMessage = (messageId: string, text: string) => {
    setEditingMessage(messageId);
    setEditText(text);
    setIsEditModalOpen(true);
  };

  // Save edited message
  const saveEditedMessage = async () => {
    if (!editingMessage || !roomId || !chatRoom) return;

    try {
      // Get reference to the specific message document in the subcollection
      const messageDocRef = doc(db, 'chatRooms', String(roomId), 'messages', editingMessage);

      // Update only the text field of the specific message document
      await updateDoc(messageDocRef, {
        text: editText,
        // Optionally update a 'lastEdited' timestamp if needed
        // lastEdited: serverTimestamp()
      });

      // Local state update is handled by the onSnapshot listener.
      // No need to call setMessages here.

      notifications.show({
        title: '메시지 수정 완료',
        message: '메시지가 성공적으로 수정되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('Error editing message:', error);
      notifications.show({
        title: '메시지 수정 실패',
        message: '메시지를 수정하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setIsEditModalOpen(false);
      setEditingMessage(null);
      setEditText('');
    }
  };

  // Delete message
  const deleteMessage = async (messageId: string) => {
    if (!roomId || !chatRoom) return;

    try {
      // Get reference to the specific message document in the subcollection
      const messageDocRef = doc(db, 'chatRooms', String(roomId), 'messages', messageId);

      // Delete the specific message document
      await deleteDoc(messageDocRef);

      // Local state update is handled by the onSnapshot listener.
      // No need to call setMessages here.

      // Note: Deleting a message won't update the chatRoom's lastMessage/lastUpdated.
      // Consider if this metadata needs updating, e.g., fetching the new last message.

      notifications.show({
        title: '메시지 삭제 완료',
        message: '메시지가 성공적으로 삭제되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('Error deleting message:', error);
      notifications.show({
        title: '메시지 삭제 실패',
        message: '메시지를 삭제하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Reroll bot message
  const rerollMessage = async (messageId: string) => {
    // Remove single chat constraints: !chatRoom.characterId || !chatRoom.character
    if (!roomId || !chatRoom || rerollingMessage || !user) return;

    setRerollingMessage(true); // Keep this for disabling button
    setRerollingMessageId(messageId); // Set the ID of the message being rerolled
    try {
      // Find the message to reroll
      const messageIndex = messages.findIndex(msg => msg.id === messageId);
      if (messageIndex === -1) return; // Message not found

      const messageToReroll = messages[messageIndex];
      if (!messageToReroll.isCharacter) return; // Can only reroll character messages

      // Find the character data for the message being rerolled
      const characterIdToReroll = messageToReroll.characterId;
      const characterToReroll = chatRoom.characters?.find(char => char.id === characterIdToReroll);
      if (!characterToReroll) {
        console.error(`Character data not found for ID: ${characterIdToReroll}`);
        notifications.show({ title: '오류', message: '리롤할 캐릭터 정보를 찾을 수 없습니다.', color: 'red' });
        setRerollingMessage(false);
        return;
      }

      // Anchor selection: always use the timeline's last message as the basis
      const anchorMessage = messages.length > 0 ? messages[messages.length - 2] : null;
      const anchorId = anchorMessage?.id;
      const lastMessageForApi = String(anchorMessage?.text ?? '').trim();

      if (process.env.NODE_ENV !== 'production') {
        console.log('[reroll][anchor]', {
          targetMessageId: messageId,
          anchorId,
          lastMessageForApiLen: lastMessageForApi.length,
          lastMessagePreview: lastMessageForApi.slice(0, 80),
        });
      }

      // Make API call: do NOT send messages array.
      // bot-response will read context from Firestore like sendMessage flow.
      const response = await fetch('/api/chat/bot-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: String(roomId),
          characterId: characterIdToReroll,
          characterName: characterToReroll.name,
          characterInfo: characterToReroll.detail || characterToReroll.description,
          senseiName: user.displayName || '선생님',
          lastMessage: lastMessageForApi,
          anchorId, // Always anchor on the latest timeline message
          isNSFW: chatRoom.isNSFW,
          enableNSFW: settings.enableNSFW,
          isBanmal: characterToReroll.isBanmal,
          userId: uid,
          lorebookIds: chatRoom.lorebookIds || [],
          // Explicit reroll hints (optional on server)
          isReroll: true,
          forceCharacterId: characterIdToReroll,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get bot response');
      }

      const botResponseData = await response.json();

      // No separate typing indicator to remove, the message was replaced in place
      // Create the final bot message with the new response
      const botResponseText = botResponseData.response || '응답을 생성하는 중 오류가 발생했습니다.';
      const botEmotion = typeof botResponseData.emotion === 'string' ? botResponseData.emotion : undefined;

      // Create the final message, keeping original ID and sender info
      const finalBotMessage: Message = {
        ...messageToReroll, // Use original message as base
        text: botResponseText,
        imageUrl: '', // Clear image on reroll
        timestamp: new Date(), // Update timestamp
      };

      // Get reference to the specific message document in the subcollection
      const messageDocRef = doc(db, 'chatRooms', String(roomId), 'messages', messageId);

      // Update the specific message document with the new text and timestamp
      // 이미지 관련 필드는 건드리지 않고 텍스트와 타임스탬프만 업데이트합니다.
      await updateDoc(messageDocRef, {
        text: finalBotMessage.text,
        emotion: botEmotion,
        timestamp: serverTimestamp(), // Use server timestamp for consistency
        isFinal: true, // 재성성 시에도 확정 상태로 변경
        // imageUrl, generatedImageUrl, imageGenPrompt, imageError 필드는 변경하지 않음
      });

      // --- Reroll 시에는 이미지 재생성 로직을 호출하지 않음 ---

      // Local state update is handled by the onSnapshot listener.
      // No need to call setMessages here.

      setRerollingMessageId(null); // Clear rerolling state on success

      notifications.show({
        title: '메시지 재생성 완료',
        message: '캐릭터 응답이 성공적으로 재생성되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('Error rerolling message:', error);
      // No need to revert messages state here as it wasn't changed for the indicator
      notifications.show({
        title: '메시지 재생성 실패',
        message: `캐릭터 응답을 재생성하는 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        color: 'red',
      });
    } finally {
      setRerollingMessageId(null); // Ensure rerolling state is cleared
      setRerollingMessage(false); // Keep this for button state
    }
  };

  // Format timestamp (Moved to MessageList component)
  // const formatMessageTime = ...

  // Handle Chat Room Deletion
  const handleDeleteChatRoom = async () => {
    if (!roomId || !user) {
      notifications.show({
        title: '오류',
        message: '채팅방 ID 또는 사용자 정보가 없습니다.',
        color: 'red',
      });
      return;
    }

    try {
      const roomDocRef = doc(db, 'chatRooms', roomId);
      await deleteDoc(roomDocRef);

      notifications.show({
        title: '채팅방 삭제 완료',
        message: '채팅방이 성공적으로 삭제되었습니다.',
        color: 'green',
      });

      // Optionally remove from user's recent chats (consider if needed)
      // const userDocRef = doc(db, 'users', user.uid);
      // await updateDoc(userDocRef, {
      //   recentChats: arrayRemove(roomId) // Need to import arrayRemove
      // });

      router.push('/chat'); // Redirect to chat list

    } catch (error) {
      console.error('Error deleting chat room:', error);
      notifications.show({
        title: '채팅방 삭제 실패',
        message: '채팅방을 삭제하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setIsDeleteConfirmModalOpen(false); // Close modal regardless of outcome
    }
  };

  // Handle toggling character active status
  const handleToggleCharacterActive = async (characterId: string) => {
    if (!roomId || !chatRoom || !chatRoom.isGroupChat || !chatRoom.activeCharacterIds || !chatRoom.characters) return;

    const currentActiveIds = chatRoom.activeCharacterIds;
    const isActive = currentActiveIds.includes(characterId);
    let newActiveIds: string[];
    let newNextSpeakerIndex = chatRoom.nextSpeakerIndex ?? 0;

    if (isActive) {
      // Deactivate character
      if (currentActiveIds.length <= 1) {
        notifications.show({
          title: '오류',
          message: '최소 한 명의 캐릭터는 활성화되어 있어야 합니다.',
          color: 'orange',
        });
        return; // Prevent deactivating the last character
      }
      newActiveIds = currentActiveIds.filter(id => id !== characterId);

      // Adjust nextSpeakerIndex if the deactivated character was next or before the current index
      const deactivatedIndex = currentActiveIds.indexOf(characterId);
      if (newNextSpeakerIndex > deactivatedIndex) {
        newNextSpeakerIndex -= 1; // Shift index back
      } else if (newNextSpeakerIndex === deactivatedIndex) {
        // If the deactivated character was the next speaker, wrap around if necessary
        newNextSpeakerIndex = newNextSpeakerIndex % newActiveIds.length;
      }
       // Ensure index is within bounds after potential removal
      if (newActiveIds.length > 0 && newNextSpeakerIndex >= newActiveIds.length) {
         newNextSpeakerIndex = 0;
      } else if (newActiveIds.length === 0) {
         newNextSpeakerIndex = -1; // No active characters left
      }


    } else {
      // Activate character - add it back in its original order if possible
      const originalIndex = chatRoom.characters.findIndex(c => c.id === characterId);
      newActiveIds = [...currentActiveIds];
      // Find the correct position to insert based on original order
      let insertPos = newActiveIds.length; // Default to end
      for (let i = 0; i < newActiveIds.length; i++) {
          const currentOriginalIndex = chatRoom.characters.findIndex(c => c.id === newActiveIds[i]);
          if (originalIndex < currentOriginalIndex) {
              insertPos = i;
              break;
          }
      }
      newActiveIds.splice(insertPos, 0, characterId);


      // Adjust nextSpeakerIndex if the activated character is inserted before the current index
      if (insertPos <= newNextSpeakerIndex) {
        newNextSpeakerIndex += 1;
      }
       // Ensure index is within bounds after potential addition
      if (newNextSpeakerIndex >= newActiveIds.length) {
         newNextSpeakerIndex = 0;
      }
    }

    // Update Firestore
    try {
      const roomDocRef = doc(db, 'chatRooms', roomId);
      await updateDoc(roomDocRef, {
        activeCharacterIds: newActiveIds,
        nextSpeakerIndex: newNextSpeakerIndex,
      });

      // Update local state immediately for responsiveness
      setChatRoom(prev => prev ? { ...prev, activeCharacterIds: newActiveIds, nextSpeakerIndex: newNextSpeakerIndex } : null);
      // Update ref immediately after successful DB update
      latestSpeakerIndexRef.current = newNextSpeakerIndex;
      console.log("Updated latestSpeakerIndexRef in handleToggleCharacterActive:", latestSpeakerIndexRef.current);

      notifications.show({
        title: '캐릭터 상태 변경',
        message: `${chatRoom.characters.find(c=>c.id === characterId)?.name} 캐릭터가 ${isActive ? '비활성화' : '활성화'}되었습니다.`,
        color: 'blue',
      });

    } catch (error) {
      console.error('Error updating character active status:', error);
      notifications.show({
        title: '업데이트 실패',
        message: '캐릭터 상태를 업데이트하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle adding characters to the chat
  const handleAddCharacters = async (idsToAdd: string[]) => {
    if (!roomId || !chatRoom || !chatRoom.isGroupChat || idsToAdd.length === 0) return;

    const currentCharacterIds = chatRoom.characterIds || [];
    const currentActiveIds = chatRoom.activeCharacterIds || [];
    const currentCharacters = chatRoom.characters || [];

    // Filter out IDs already present
    const newIdsToAdd = idsToAdd.filter(id => !currentCharacterIds.includes(id));
    if (newIdsToAdd.length === 0) {
      notifications.show({ title: '정보', message: '선택된 모든 캐릭터가 이미 채팅방에 있습니다.', color: 'blue' });
      return;
    }

    // Fetch data for the new characters to add
    let newCharactersData: Character[] = [];
    try {
      const charDocs = await Promise.all(
        newIdsToAdd.map(id => getDoc(doc(db, 'characters', id)))
      );
      newCharactersData = charDocs
        .filter(d => d.exists())
        .map(d => ({ id: d.id, ...d.data() } as Character));
    } catch (fetchError) {
      console.error("Error fetching new character data:", fetchError);
      notifications.show({ title: '오류', message: '추가할 캐릭터 정보를 불러오는 중 오류 발생', color: 'red' });
      return;
    }

    if (newCharactersData.length !== newIdsToAdd.length) {
      console.warn("Some characters to add were not found in the database.");
      // Proceed with the ones that were found
    }
    const foundNewIds = newCharactersData.map(c => c.id);
    const finalNewCharacters = newCharactersData; // Characters to add to local state

    const updatedCharacterIds = [...currentCharacterIds, ...foundNewIds];
    const updatedActiveIds = [...currentActiveIds, ...foundNewIds]; // Add new characters as active by default
    const updatedCharacters = [...currentCharacters, ...finalNewCharacters]; // Add to local character list

    // Update Firestore
    try {
      const roomDocRef = doc(db, 'chatRooms', roomId);
      await updateDoc(roomDocRef, {
        characterIds: updatedCharacterIds,
        activeCharacterIds: updatedActiveIds,
        // Optionally update nextSpeakerIndex if needed, maybe reset to 0?
        // nextSpeakerIndex: 0
      });

      // Update local state
      setChatRoom(prev => prev ? {
        ...prev,
        characterIds: updatedCharacterIds,
        activeCharacterIds: updatedActiveIds,
        characters: updatedCharacters,
        // nextSpeakerIndex: 0 // Update local state if index is reset
      } : null);

      // Update available characters list locally (remove added ones)
      setAvailableCharacters(prev => prev.filter(char => !foundNewIds.includes(char.id)));
      setCharactersToAdd([]); // Clear selection

      notifications.show({
        title: '캐릭터 추가 완료',
        message: `${finalNewCharacters.map(c => c.name).join(', ')} 캐릭터가 추가되었습니다.`,
        color: 'green',
      });

    } catch (error) {
      console.error('Error adding characters to chat room:', error);
      notifications.show({ title: '업데이트 실패', message: '캐릭터를 추가하는 중 오류 발생', color: 'red' });
    }
  };

  // Handle removing a character from the chat
  const handleRemoveCharacter = async (idToRemove: string) => {
    if (!roomId || !chatRoom || !chatRoom.isGroupChat || !chatRoom.characterIds || !chatRoom.characters) return;

    if (chatRoom.characterIds.length <= 1) {
       notifications.show({ title: '오류', message: '채팅방에는 최소 한 명의 캐릭터가 있어야 합니다.', color: 'orange' });
       return;
    }

    const characterToRemove = chatRoom.characters.find(c => c.id === idToRemove);
    if (!characterToRemove) return; // Should not happen if UI is correct

    const updatedCharacterIds = chatRoom.characterIds.filter(id => id !== idToRemove);
    const updatedActiveIds = (chatRoom.activeCharacterIds || []).filter(id => id !== idToRemove);
    const updatedCharacters = chatRoom.characters.filter(c => c.id !== idToRemove);
    let updatedNextSpeakerIndex = chatRoom.nextSpeakerIndex ?? 0;

    // Adjust speaker index if the removed character affects it
    const removedIndexInActive = (chatRoom.activeCharacterIds || []).indexOf(idToRemove);
    if (removedIndexInActive !== -1) { // Only adjust if the removed character was active
       if (updatedNextSpeakerIndex > removedIndexInActive) {
          updatedNextSpeakerIndex -= 1;
       } else if (updatedNextSpeakerIndex === removedIndexInActive) {
          // If removed was next, wrap around
          updatedNextSpeakerIndex = updatedNextSpeakerIndex % updatedActiveIds.length;
       }
    }
     // Ensure index is valid after removal
    if (updatedActiveIds.length > 0 && updatedNextSpeakerIndex >= updatedActiveIds.length) {
       updatedNextSpeakerIndex = 0;
    } else if (updatedActiveIds.length === 0) {
       updatedNextSpeakerIndex = -1; // Should be prevented by the check above, but good failsafe
    }


    // Update Firestore
    try {
      const roomDocRef = doc(db, 'chatRooms', roomId);
      await updateDoc(roomDocRef, {
        characterIds: updatedCharacterIds,
        activeCharacterIds: updatedActiveIds,
        nextSpeakerIndex: updatedNextSpeakerIndex,
      });

      // Update local state
      setChatRoom(prev => prev ? {
        ...prev,
        characterIds: updatedCharacterIds,
        activeCharacterIds: updatedActiveIds,
        characters: updatedCharacters,
        nextSpeakerIndex: updatedNextSpeakerIndex,
      } : null);
       // Update ref immediately after successful DB update
       latestSpeakerIndexRef.current = updatedNextSpeakerIndex;
       console.log("Updated latestSpeakerIndexRef in handleRemoveCharacter:", latestSpeakerIndexRef.current);


      // Add removed character back to available list locally
      setAvailableCharacters(prev => [...prev, characterToRemove].sort((a, b) => a.name.localeCompare(b.name))); // Add back and sort

      notifications.show({
        title: '캐릭터 제거 완료',
        message: `${characterToRemove.name} 캐릭터가 채팅방에서 제거되었습니다.`,
        color: 'green',
      });

    } catch (error) {
      console.error('Error removing character from chat room:', error);
      notifications.show({ title: '업데이트 실패', message: '캐릭터를 제거하는 중 오류 발생', color: 'red' });
    }
  };

  // Handle "Continue Conversation" for group chats when player is inactive
  const handleContinueConversation = async () => {
     if (!chatRoom || !chatRoom.isGroupChat || !chatRoom.activeCharacterIds || chatRoom.activeCharacterIds.length === 0 || !user || continuingConversation || isPlayerActive) return;

     setContinuingConversation(true);
     const botMessagesBatch: Message[] = [];
     let finalNextSpeakerIndex = chatRoom.nextSpeakerIndex ?? 0;
     // Use the current messages state as context
     // Fetch the latest messages directly from Firestore to ensure context is up-to-date
     const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
     const messagesQuery = query(messagesColRef, orderBy('timestamp', 'asc'));
     const querySnapshot = await getDocs(messagesQuery);
     const latestMessages: Message[] = [];
     querySnapshot.forEach((doc) => {
         const data = doc.data();
         const timestamp = data.timestamp?.toDate ? data.timestamp.toDate() : new Date(); // Convert timestamp
         // 명시적으로 필요한 필드를 모두 추출하여 Message 객체 생성
         latestMessages.push({
           id: doc.id,
           senderId: data.senderId,
           senderName: data.senderName,
           senderAvatar: data.senderAvatar || '',
           isCharacter: data.isCharacter || false,
           characterId: data.characterId || '',
           text: data.text,
           imageUrl: data.imageUrl || '',
           generatedImageUrl: data.generatedImageUrl || undefined,
           imageGenPrompt: data.imageGenPrompt || undefined,
           imageError: data.imageError || false,
           timestamp
         } as Message);
     });
     // Now use latestMessages for the context
     const accumulatedMessages = [...latestMessages]; // Use let as it will be modified in the loop

     const activeChars = chatRoom.activeCharacterIds;
     const numActive = activeChars.length;
     let currentSpeakerIndex = chatRoom.nextSpeakerIndex ?? 0;

     if (currentSpeakerIndex < 0 || currentSpeakerIndex >= numActive) {
        currentSpeakerIndex = 0; // Reset if invalid
     }

     for (let i = 0; i < numActive; i++) {
       const speakerIndex = (currentSpeakerIndex + i) % numActive;
       const characterId = activeChars[speakerIndex];
       const character = chatRoom.characters?.find(char => char.id === characterId);

       if (!character) continue;

       const typingIndicatorId = `typing-${characterId}`;
       try {
         // Show typing indicator
         const typingIndicator: Message = {
           id: typingIndicatorId,
           senderId: 'bot',
           senderName: character.name,
           senderAvatar: character.image || '',
           isCharacter: true,
           characterId: characterId,
           text: '입력 중...',
           imageUrl: '',
           generatedImageUrl: null, // undefined 대신 null 사용
           imageGenPrompt: null, // undefined 대신 null 사용
           imageError: false,
           timestamp: new Date(),
         };
         setMessages(prev => [...prev, typingIndicator]);

         // Make API call
         const response = await fetch('/api/chat/bot-response', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({
             roomId: String(roomId),
             characterId: characterId,
             characterName: character.name,
             characterInfo: character.detail || character.description,
             senseiName: user.displayName || '선생님',
             lastMessage: accumulatedMessages.length > 0 ? accumulatedMessages[accumulatedMessages.length - 1].text : '', // Last message in context
              isNSFW: chatRoom.isNSFW,
              enableNSFW: settings.enableNSFW,
              isBanmal: character.isBanmal,
              userId: uid,
              lorebookIds: chatRoom.lorebookIds || [], // 로어북 ID 전달
            }),
          });

         // Remove typing indicator
         setMessages(prev => prev.filter(msg => msg.id !== typingIndicatorId));

         if (!response.ok) {
           const errorBody = await response.text();
           console.error(`API Error for ${character.name} (Continue):`, errorBody);
           continue; // Skip to next character on error
         }

         const botResponseData = await response.json();
         const botResponseText = botResponseData.response || `(${character.name}의 응답 생성 오류)`;
         const botEmotion = typeof botResponseData.emotion === 'string' ? botResponseData.emotion : undefined;

         const botMessage: Message = {
           id: uuidv4(),
           senderId: 'bot',
           senderName: character.name,
           senderAvatar: character.image || '',
           isCharacter: true,
           characterId: characterId,
           text: botResponseText,
           emotion: botEmotion,
           imageUrl: '',
           generatedImageUrl: null, // undefined 대신 null 사용
           imageGenPrompt: null, // undefined 대신 null 사용
           imageError: false,
           timestamp: new Date(),
         };

         // Add bot message to subcollection immediately
         const messagesColRef = collection(db, 'chatRooms', String(roomId), 'messages');
         const botMessageDocRef = await addDoc(messagesColRef, {
             ...botMessage,
             timestamp: serverTimestamp()
         });
         // botMessage.id = botMessageDocRef.id; // Update local ID if needed
         // botMessage.timestamp = new Date(); // Approximate timestamp

         botMessagesBatch.push(botMessage); // Still add to batch for context and last message update
         // Add the newly generated bot message to the context for the *next* API call within this loop
         // 명시적으로 필요한 필드를 모두 추출하여 Message 객체 생성
         accumulatedMessages.push({
           id: botMessageDocRef.id,
           senderId: botMessage.senderId,
           senderName: botMessage.senderName,
           senderAvatar: botMessage.senderAvatar,
           isCharacter: botMessage.isCharacter,
           characterId: botMessage.characterId,
           text: botMessage.text,
           imageUrl: botMessage.imageUrl,
           generatedImageUrl: botMessage.generatedImageUrl,
           imageGenPrompt: botMessage.imageGenPrompt,
           imageError: botMessage.imageError,
           timestamp: new Date() // Use approximate timestamp for context
         });
         // Local state update handled by listener
         // setMessages(prev => [...prev, botMessage]);

       } catch (error) {
          console.error(`Error continuing conversation for ${character.name}:`, error);
          setMessages(prev => prev.filter(msg => msg.id !== typingIndicatorId)); // Ensure indicator removal
          notifications.show({
            title: `${character.name} 응답 오류`,
            message: `이어하기 중 오류: ${error instanceof Error ? error.message : String(error)}`,
            color: 'red',
          });
       }
     }
     // Next speaker is back to the original starting index for the *next* turn (user or continue)
     finalNextSpeakerIndex = currentSpeakerIndex;

      // Update Firestore metadata after bot responses
      if (botMessagesBatch.length > 0) {
        // Bot messages were already added individually using addDoc in the loop above
        try {
          const roomDocRef = doc(db, 'chatRooms', String(roomId)); // Ensure roomId is string
          await updateDoc(roomDocRef, {
            // messages: arrayUnion(...botMessagesBatch), // REMOVED - messages are in subcollection
            lastMessage: botMessagesBatch[botMessagesBatch.length - 1].text,
            lastUpdated: serverTimestamp(),
            nextSpeakerIndex: finalNextSpeakerIndex,
          });
           // Update local state for speaker index
           setChatRoom(prev => prev ? { ...prev, nextSpeakerIndex: finalNextSpeakerIndex } : null);
           // Update ref immediately after successful DB update
           latestSpeakerIndexRef.current = finalNextSpeakerIndex;
           console.log("Updated latestSpeakerIndexRef in handleContinueConversation:", latestSpeakerIndexRef.current);
        } catch (updateError) {
           console.error("Error updating Firestore metadata after continuing conversation:", updateError);
           notifications.show({ title: '메타데이터 업데이트 오류', message: '이어하기 응답 저장 중 오류 발생', color: 'red' });
        }
      } else {
         // If no messages were generated, maybe still update index? Or show notification?
         notifications.show({ title: '정보', message: '캐릭터들이 더 이상 할 말이 없는 것 같습니다.', color: 'blue' });
         const currentSpeakerCharId = activeChars[finalNextSpeakerIndex];
         const currentSpeakerChar = chatRoom.characters?.find(char => char.id === currentSpeakerCharId);

         if (currentSpeakerChar) {
             const emptyMessage: Omit<Message, 'id' | 'timestamp'> = {
                 senderId: 'bot',
                 senderName: currentSpeakerChar.name,
                 senderAvatar: currentSpeakerChar.image || '',
                 isCharacter: true,
                 characterId: currentSpeakerChar.id,
                 text: '.',
                 imageUrl: '',
             };

             try {
                 await addDoc(messagesColRef, {
                     ...emptyMessage,
                     timestamp: serverTimestamp()
                 });
                 console.log(`Added empty message placeholder for ${currentSpeakerChar.name}`);
             } catch (addMsgError) {
                 console.error("Error adding empty message placeholder:", addMsgError);
                 // 공백 메시지 추가 실패 시 알림 표시 (선택 사항)
                 notifications.show({ title: '오류', message: '메시지 기록 중 오류가 발생했습니다.', color: 'red' });
             }
         } else {
             console.warn("Could not find character for empty message placeholder at index:", finalNextSpeakerIndex);
             // 캐릭터를 찾지 못했을 경우 알림 표시 (선택 사항)
             notifications.show({ title: '오류', message: '메시지 기록 중 캐릭터 정보를 찾지 못했습니다.', color: 'red' });
         }
         // --- 수정 끝 ---
         // Optionally update index even if no messages were generated
         try {
            const roomDocRef = doc(db, 'chatRooms', String(roomId));
            await updateDoc(roomDocRef, { nextSpeakerIndex: finalNextSpeakerIndex });
            setChatRoom(prev => prev ? { ...prev, nextSpeakerIndex: finalNextSpeakerIndex } : null);
            latestSpeakerIndexRef.current = finalNextSpeakerIndex;
            console.log("Updated latestSpeakerIndexRef in handleContinueConversation (no bot messages):", latestSpeakerIndexRef.current);
         } catch (indexUpdateError) {
             console.error("Error updating speaker index after failed continue:", indexUpdateError);
         }
      }

     setContinuingConversation(false);
  };

    // 이미지 재성성 핸들러
  const handleOpenRegenerateImageModal = (messageId: string, imageUrl: string | undefined, generatedPrompt?: string) => {
    // 전달받은 기존 이미지 URL과 프롬프트를 모달 상태에 그대로 반영
    setRegenerateImageInfo({ messageId, imageUrl, currentPrompt: generatedPrompt || '' });
    setNewRegeneratePrompt(generatedPrompt || ''); // API로부터 받은 생성된 프롬프트를 초기값으로 설정
    setIsRegenerateImageModalOpen(true);
  };

  const handleConfirmRegenerateImage = async () => {
    if (!regenerateImageInfo || !roomId || !chatRoom || !user) return;

    const { messageId, imageUrl, currentPrompt } = regenerateImageInfo;
    // 사용자가 모달에서 새로 입력한 프롬프트가 있으면 그것을 사용하고, 없으면 API에서 받아온 currentPrompt(generatedPrompt)를 사용
    const promptForApi = newRegeneratePrompt.trim() || currentPrompt || '';


    if (!promptForApi) {
        notifications.show({
            title: '프롬프트 필요',
            message: '이미지 재성성을 위한 프롬프트가 필요합니다.',
            color: 'yellow',
        });
        return;
    }

    // 메시지 ID로 해당 메시지 찾기
    const messageToRegenerate = messages.find(msg => msg.id === messageId);
    if (!messageToRegenerate) {
        notifications.show({ title: '오류', message: '이미지를 재성성할 메시지를 찾을 수 없습니다.', color: 'red' });
        return;
    }

    // 메시지 보낸 캐릭터 정보 찾기
    const characterForImage = chatRoom.characters?.find(char => char.id === messageToRegenerate.characterId);
    if (!characterForImage) {
        notifications.show({ title: '오류', message: '이미지 재성성을 위한 캐릭터 정보를 찾을 수 없습니다.', color: 'red' });
        return;
    }

    // 현재 선택된 페르소나 정보 찾기
    const currentUserPersona = selectedPersonaId ? userPersonas.find(p => p.id === selectedPersonaId) : null;

    setIsRegeneratingImage(true); // 모달 버튼 로딩 상태 시작

    try {
      console.log(`Image regeneration userId: ${uid}`);
      const response = await fetch('/api/regenerate-image', { // 새로운 재성성 API 엔드포인트 사용
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageGenPrompt: promptForApi, // 사용자가 입력하거나 기존에 생성된 프롬프트를 전달
          roomId: String(roomId),
          isRoomNSFW: characterForImage.isNSFW, // 캐릭터의 NSFW 설정 사용
          originalImageUrl: imageUrl, // img2img를 위한 원본 이미지 URL 전달 (있을 경우)
          userId: user.uid, // 사용자 ID 전달
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || '이미지 재성성에 실패했습니다.');
      }

      // Firestore 메시지 업데이트 (성공 시)
      const messageDocRef = doc(db, 'chatRooms', String(roomId), 'messages', messageId);
      const successUpdateData: { generatedImageUrl: string; text?: string; imageError?: boolean; imageGenPrompt?: string } = {
        generatedImageUrl: result.imageUrl,
        imageError: false, // 성공 시 오류 상태 해제
      };
      if (result.imageGenPrompt) {
        successUpdateData.imageGenPrompt = result.imageGenPrompt;
      } else if (result.generatedPrompt) {
        successUpdateData.imageGenPrompt = result.generatedPrompt;
      }

      setNewRegeneratePrompt(successUpdateData.imageGenPrompt || '');

      // 이미지 재성성 시에는 메시지 텍스트를 변경하지 않습니다.
      // Firestore 업데이트 시 text 필드는 건드리지 않고, imageGenPrompt만 업데이트합니다.
      const updateData: { generatedImageUrl: string; imageError?: boolean; imageGenPrompt?: string } = {
        generatedImageUrl: result.imageUrl,
        imageError: false, // 성공 시 오류 상태 해제
      };

      if (result.imageGenPrompt) {
        updateData.imageGenPrompt = result.imageGenPrompt;
      } else if (result.generatedPrompt) {
        updateData.imageGenPrompt = result.generatedPrompt;
      }
      // setNewRegeneratePrompt는 모달의 입력 필드를 업데이트하므로, API 응답의 프롬프트로 설정합니다.
      setNewRegeneratePrompt(updateData.imageGenPrompt || '');

      await updateDoc(messageDocRef, updateData);


      notifications.show({
        title: '이미지 생성/재성성 완료',
        message: '이미지가 성공적으로 처리되었습니다.',
        color: 'green',
      });
    } catch (err: any) {
      console.error("Error regenerating image:", err);
      notifications.show({ title: '이미지 생성/재성성 실패', message: err.message, color: 'red' });
      // Firestore 메시지 업데이트 (실패 시)
      if (regenerateImageInfo) { // regenerateImageInfo가 있어야 messageId를 알 수 있음
        const messageDocRef = doc(db, 'chatRooms', String(roomId), 'messages', regenerateImageInfo.messageId);
        try {
          await updateDoc(messageDocRef, {
            generatedImageUrl: null, // 또는 이전 값 유지, 또는 특정 에러 값
            imageError: true, // 오류 상태 플래그 설정
          });
        } catch (updateError) {
          console.error("Error updating message on image generation failure:", updateError);
        }
      }
    } finally {
      setIsRegenerateImageModalOpen(false); // 작업 완료 후 모달을 닫습니다.
      setIsRegeneratingImage(false); // 모달 버튼 로딩 상태 종료
      setRegeneratingImageId(null); // 메시지 리스트 아이템 로딩 상태 초기화 (필요시)
      setRegenerateImageInfo(null);
      setNewRegeneratePrompt('');
    }
  };

  // Handle sharing the chat room link (copy data to shared collection with new ID)
  const handleShareChat = async () => {
    if (!roomId || !chatRoom || !messages) {
      notifications.show({
        title: '오류',
        message: '채팅방 정보를 공유할 수 없습니다.',
        color: 'red',
      });
      return;
    }

    // Generate a new unique ID for the shared chat
    const shareRoomId = uuidv4();
    let shareUrl = `${window.location.origin}/chat/share/${shareRoomId}`;

    if (roomUI.skin === 'novel') {
      shareUrl = `${window.location.origin}/chat/share/novel/${shareRoomId}`;
    }

    const sharedRoomRef = doc(db, 'sharedChatRooms', shareRoomId); // Use the new shareRoomId

    // Helper function to remove undefined values from an object recursively
    const removeUndefinedValues = (obj: any): any => {
      if (Array.isArray(obj)) {
        return obj.map(removeUndefinedValues);
      } else if (obj !== null && typeof obj === 'object') {
        return Object.entries(obj).reduce((acc, [key, value]) => {
          const cleanedValue = removeUndefinedValues(value);
          if (cleanedValue !== undefined) {
            // @ts-expect-error @typescript-eslint/ban-ts-comment
            acc[key] = cleanedValue;
          }
          return acc;
        }, {});
      }
      return obj; // Return primitive values as is
    };

    // Prepare data to share, removing undefined values
    const { characterId, ...restOfChatRoom } = chatRoom;
    const cleanedMessages = messages.map(msg => removeUndefinedValues(msg)); // Clean messages array

    const baseSharedData = {
      ...restOfChatRoom,
      messages: cleanedMessages, // Use cleaned messages
      sharedAt: serverTimestamp(),
      originalRoomId: roomId,
    };

    // Only include characterId if it exists
    if (characterId) {
      // @ts-expect-error @typescript-eslint/ban-ts-comment
      baseSharedData.characterId = characterId;
    }

    // Clean the final sharedData object
    const sharedData = removeUndefinedValues(baseSharedData);

    try {
      // Use setDoc to create the new shared document with the unique ID
      await setDoc(sharedRoomRef, sharedData); // Use cleaned data

      // Copy the new share link to clipboard
      navigator.clipboard.writeText(shareUrl)
        .then(() => {
          notifications.show({
            title: '공유 준비 완료',
            message: '채팅 내용이 복사되었고, 공유 링크가 클립보드에 복사되었습니다.',
            color: 'green',
          });
        })
        .catch(err => {
          console.error('Failed to copy share link: ', err);
          notifications.show({
            title: '링크 복사 실패',
            message: '채팅 내용 복사 후 링크를 복사하는 중 오류가 발생했습니다.',
            color: 'red',
          });
        });

    } catch (error) {
      console.error('Error saving chat data for sharing:', error);
      notifications.show({
        title: '공유 실패',
        message: '채팅 내용을 공유용으로 복사하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle converting a single chat to a group chat
  const handleConvertToGroupChat = async () => {
    if (!roomId || !chatRoom || chatRoom.isGroupChat || !chatRoom.characterId) {
      notifications.show({
        title: '오류',
        message: '그룹 채팅으로 변환할 수 없는 채팅방입니다.',
        color: 'red',
      });
      return;
    }

    try {
      const roomDocRef = doc(db, 'chatRooms', String(roomId));
      const singleCharacterId = chatRoom.characterId;

      await updateDoc(roomDocRef, {
        isGroupChat: true,
        characterIds: [singleCharacterId], // Move single ID to array
        activeCharacterIds: [singleCharacterId], // Start with the original character active
        nextSpeakerIndex: 0, // Reset speaker index
        characterId: deleteField(), // Use deleteField() to remove the field
      });

      // Update local state immediately for responsiveness
      setChatRoom(prev => prev ? {
        ...prev,
        isGroupChat: true,
        characterIds: [singleCharacterId],
        activeCharacterIds: [singleCharacterId],
        nextSpeakerIndex: 0,
        characterId: undefined, // Keep local state as undefined, Firestore handles deletion
        // Ensure the single character is in the characters array if not already
        characters: prev.characters?.length ? prev.characters : (prev.character ? [prev.character] : []),
      } : null);

      notifications.show({
        title: '변환 완료',
        message: '채팅방이 단체 채팅방으로 변환되었습니다.',
        color: 'green',
      });

      // Optionally open the manage characters modal immediately
      // setIsManageCharsModalOpen(true);

    } catch (error) {
      console.error('Error converting chat room to group chat:', error);
      notifications.show({
        title: '변환 실패',
        message: '채팅방을 단체 채팅방으로 변환하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle chat room image change
  const handleImageChange = async (file: File) => {
    if (!roomId || !chatRoom || !chatRoom.isGroupChat) return;

    setIsUploadingImage(true);
    try {
      const storageRef = ref(storage, `chatRoomImages/${roomId}/${uuidv4()}`);
      await uploadBytes(storageRef, file);
      const imageUrl = await getDownloadURL(storageRef);

      const roomDocRef = doc(db, 'chatRooms', String(roomId));
      await updateDoc(roomDocRef, {
        image: imageUrl,
      });

      // Update local state
      setChatRoom(prev => prev ? { ...prev, image: imageUrl } : null);

      notifications.show({
        title: '이미지 변경 완료',
        message: '채팅방 이미지가 성공적으로 변경되었습니다.',
        color: 'green',
      });

    } catch (error) {
      console.error('Error changing chat room image:', error);
      notifications.show({
        title: '이미지 변경 실패',
        message: '채팅방 이미지를 변경하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setIsUploadingImage(false);
    }
  };

  // Handle chat room name change
  const handleNameChange = async (newName: string) => {
    if (!roomId || !chatRoom || !newName.trim()) return;

    const trimmedName = newName.trim();
    if (trimmedName === chatRoom.name) return; // No change

    try {
      const roomDocRef = doc(db, 'chatRooms', String(roomId));
      await updateDoc(roomDocRef, {
        name: trimmedName,
      });

      // Update local state
      setChatRoom(prev => prev ? { ...prev, name: trimmedName } : null);

      notifications.show({
        title: '이름 변경 완료',
        message: '채팅방 이름이 성공적으로 변경되었습니다.',
        color: 'green',
      });

    } catch (error) {
      console.error('Error changing chat room name:', error);
      notifications.show({
        title: '이름 변경 실패',
        message: '채팅방 이름을 변경하는 중 오류가 발생했습니다.',
        color: 'red',
      });
      // Re-throw the error so the ChatHeader can handle its state
      throw error;
    }
  };

  // Handle saving lorebook settings
  const handleSaveLorebookSettings = async (
    selectedLorebookIds: string[],
    opts?: { orderMode?: 'room_first' | 'character_first' }
  ) => {
    if (!roomId || !chatRoom) {
      throw new Error("채팅방 정보가 유효하지 않습니다."); // Let the modal handle the notification
    }

    const roomDocRef = doc(db, 'chatRooms', String(roomId));
    try {
      await updateDoc(roomDocRef, {
        lorebookIds: selectedLorebookIds,
        ...(opts?.orderMode ? { lorebookOrderMode: opts.orderMode } : {}),
      });
      // Update local state immediately
      setChatRoom(prev => prev ? { ...prev, lorebookIds: selectedLorebookIds } : null);
      if (opts?.orderMode) setLorebookOrderMode(opts.orderMode);
    } catch (error) {
      console.error("Error updating lorebook settings in Firestore:", error);
      // Re-throw error for the modal to catch and display notification
      throw error;
    }
  };


  // Loading and Error States
  if (loading) {
    return (
      <AppShell>
        <Container size="lg" py="xl">
          <Stack align="center">
            <Loader />
            <Text>채팅방을 불러오는 중...</Text>
          </Stack>
        </Container>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <Container size="lg" py="xl">
          <Paper p="xl" withBorder>
            <Stack align="center" gap="md">
              <ThemeIcon size="xl" radius="xl" variant="light" color="red">
                 <IconAlertCircle size={32} />
              </ThemeIcon>
              <Text c="red" ta="center">{error}</Text>
              <Group mt="md">
                <Button
                  onClick={() => router.back()}
                  leftSection={<IconArrowBack size={16} />}
                >
                  뒤로가기
                </Button>
                {/* Optionally add a retry button */}
                {/* <Button onClick={setupChatRoom}>다시 시도</Button> */}
              </Group>
            </Stack>
          </Paper>
        </Container>
      </AppShell>
    );
  }

  // Main Chat Room UI
  return (
    <AppShell>
      {/* Risu 스킨 분기: novel일 때 전용 셸로 감싸기 */}
      {roomUI.skin === 'novel' ? (
        <>
          {/* 헤더: RisuHeader + UI 토글 - 상단에 배치 */}
          {/* 배경은 RisuChatShell 내부 레이어가 담당하며, 선택된 갤러리 이미지가 우선, 없으면 roomUI.backgroundImage */}
        </>
      ) : null}
      {/* Render Edit Message Modal */}
      <EditMessageModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        editText={editText}
        setEditText={setEditText}
        onSave={saveEditedMessage}
      />

      {/* Render Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={isDeleteConfirmModalOpen}
        onClose={() => setIsDeleteConfirmModalOpen(false)}
        onConfirm={handleDeleteChatRoom}
      />

       {/* Render Manage Characters Modal */}
       <ManageCharactersModal
         isOpen={isManageCharsModalOpen}
         onClose={() => setIsManageCharsModalOpen(false)}
         chatRoom={chatRoom}
         userId={uid ?? ''} // Pass userId from useAuth
         // Removed availableCharacters and loadingAvailableChars props
         charactersToAdd={charactersToAdd}
         setCharactersToAdd={setCharactersToAdd}
         handleAddCharacters={handleAddCharacters}
         handleToggleCharacterActive={handleToggleCharacterActive}
         handleRemoveCharacter={handleRemoveCharacter}
       />


      {/* Main Chat Area */}
      <Container size="fluid" px={{ base: 0, sm: 'md' }} py="md">
        {/* Risu 전용 렌더 */}
        {roomUI.skin === 'novel' ? (
          <div style={{ position: 'relative' }}>
            {/* Risu Shell */}
            {/* 동적 배경: 갤러리 선택이 우선, 없으면 roomUI.backgroundImage */}
            <NovelChatShell
              ui={{ ...roomUI, backgroundImage: selectedBgUrl ?? roomUI.backgroundImage ?? null }}
              header={
                <NovelHeader
                  title={chatRoom?.name}
                  subtitle={chatRoom?.description}
                  description={chatRoom?.description}
                  image={chatRoom?.image}
                  ui={roomUI}
                  onSkinChange={(v) => {
                    handleUpdateUISkin(v);
                  }}
                  onBack={() => router.push('/chat')}
                  // 액션 메뉴 항목
                  onShare={handleShareChat}
                  onConvertToGroupChat={handleConvertToGroupChat}
                  onOpenLorebookSettings={openLorebookModal}
                  onExport={openExportModal}
                  onDelete={handleDeleteChatRoom}
                  // 인라인 이름 편집 저장
                  onNameChange={handleNameChange}
                  isGroupChat={chatRoom?.isGroupChat}
                />
              }
              footer={
                <NovelMessageInput
                  messageList={messages}
                  newMessage={newMessage}
                  setNewMessage={setNewMessage}
                  sendMessage={sendMessage}
                  imagePreview={imagePreview}
                  setImagePreview={setImagePreview}
                  setImageUpload={setImageUpload}
                  fileInputRef={fileInputRef}
                  handleImageSelect={handleImageSelect}
                  sendingMessage={sendingMessage}
                  chatRoom={chatRoom}
                  isPlayerActive={isPlayerActive}
                  setIsPlayerActive={setIsPlayerActive}
                  handleContinueConversation={handleContinueConversation}
                  continuingConversation={continuingConversation}
                  characters={userPersonas}
                  selectedPersonaId={selectedPersonaId}
                  setSelectedPersonaId={handleSetSelectedPersonaId}
                  showPersonaSelector={settings.showPersonaSelector}
                  user={user}
                  showRefineButton={settings.showRefineButton}
                />
              }
            >
              {/* Risu 메시지 리스트: assistant/system HTML 그대로 출력 */}
              <div style={{ paddingTop: 8 }}>
                <NovelMessageList
                  messages={messages.map((m) => ({
                    id: m.id,
                    role: m.isCharacter ? 'assistant' : (m.senderId === user?.uid ? 'user' : 'assistant'),
                    text: m.text, // HTML 그대로 들어올 수 있음
                    // NovelMessageItem에서 표시 우선순위: displayImageUrl > generatedImageUrl > additionalImage > imageUrl
                    // displayImageUrl와 generatedImageUrl, isFinal을 명시적으로 전달해 우선순위가 기대대로 동작하도록 함
                    imageUrl: m.isCharacter ? (m.displayImageUrl || undefined) : (m.imageUrl || undefined),
                    displayImageUrl: m.displayImageUrl,
                    generatedImageUrl: m.generatedImageUrl ?? undefined,
                    imageGenPrompt: m.imageGenPrompt ?? undefined,
                    isFinal: m.isFinal ?? undefined,
                    caption: undefined,
                    senderName: m.senderName,
                    senderId: m.senderId,
                    characterId: m.characterId,
                    emotion: m.emotion,
                    timestamp: m.timestamp,
                    isCharacter: m.isCharacter,
                  }))}
                  ui={roomUI}
                  characters={chatRoom?.characters}
                  currentUserId={user?.uid || null}
                  onEditMessage={handleEditMessage}
                  onDeleteMessage={deleteMessage}
                  onForkMessage={handleFork}
                  onRerollMessage={rerollMessage}
                  onRegenerateImage={handleOpenRegenerateImageModal}
                  rerollingMessageId={rerollingMessageId}
                  regeneratingImageId={regeneratingImageId}
                  isRerollingMessage={rerollingMessage}
                  isForkLoading={false}
                  hasMore={hasMore}
                  isLoadingMore={isLoadingMore}
                  onLoadMore={loadOlderMessages}
                />
              </div>
            </NovelChatShell>
          </div>
        ) : (
          <ClassicChatShell
            ui={roomUI}
            header={
              <ChatHeader
                chatRoom={chatRoom}
                router={router}
                setIsManageCharsModalOpen={setIsManageCharsModalOpen}
                setIsDeleteConfirmModalOpen={setIsDeleteConfirmModalOpen}
                onShare={handleShareChat}
                onConvertToGroupChat={handleConvertToGroupChat}
                onImageChange={handleImageChange}
                isUploadingImage={isUploadingImage}
                onNameChange={handleNameChange}
                onExport={openExportModal}
                onOpenLorebookSettings={openLorebookModal}
                ui={roomUI}
                onUpdateUI={(patch) => {
                  setRoomUI((prev) => ({ ...prev, ...patch }));
                  const rid = typeof roomId === 'string' ? roomId : '';
                  if (rid && patch.skin) {
                    debouncedUpdateUISkin(rid, patch.skin);
                  }
                }}
              />
            }
            footer={
              <MessageInput
                messageList={messages}
                newMessage={newMessage}
                setNewMessage={setNewMessage}
                sendMessage={sendMessage}
                imagePreview={imagePreview}
                setImagePreview={setImagePreview}
                setImageUpload={setImageUpload}
                fileInputRef={fileInputRef}
                handleImageSelect={handleImageSelect}
                sendingMessage={sendingMessage}
                chatRoom={chatRoom}
                isPlayerActive={isPlayerActive}
                setIsPlayerActive={setIsPlayerActive}
                handleContinueConversation={handleContinueConversation}
                continuingConversation={continuingConversation}
                characters={userPersonas}
                selectedPersonaId={selectedPersonaId}
                setSelectedPersonaId={handleSetSelectedPersonaId}
                showPersonaSelector={settings.showPersonaSelector}
                user={user}
              />
            }
          >
            <Box style={{ flex: 1, minHeight: 0 }}>
              <MessageList
                messages={messages}
                user={user}
                scrollAreaRef={scrollAreaRef}
                messagesEndRef={messagesEndRef}
                rerollingMessageId={rerollingMessageId}
                handleEditMessage={handleEditMessage}
                deleteMessage={deleteMessage}
                rerollMessage={rerollMessage}
                rerollingMessage={rerollingMessage}
                loadOlderMessages={loadOlderMessages}
                hasMore={hasMore}
                isLoadingMore={isLoadingMore}
                handleRegenerateImage={handleOpenRegenerateImageModal}
                regeneratingImageId={regeneratingImageId}
                onFork={handleFork}
              />
            </Box>
          </ClassicChatShell>
        )}
      </Container>

      {/* Hidden File Input - 모든 모드에서 공통으로 사용 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: 'none' }}
        accept="image/*"
        onChange={handleFileChange}
      />

      {/* Export Confirmation Modal */}
      <Modal
        opened={openedExport}
        onClose={closeExportModal}
        title="채팅 내용 내보내기"
        centered
      >
        <Stack>
          <Text>현재 채팅방 내용을 txt 파일로 내보냅니다.</Text>
          <Checkbox
            label="내 메시지 포함하기"
            checked={includeUserMessages}
            onChange={(event) => setIncludeUserMessages(event.currentTarget.checked)}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={closeExportModal} disabled={exportLoading}>취소</Button>
            <Button
              leftSection={<IconDownload size={16} />}
              onClick={handleExportCurrentRoom}
              loading={exportLoading}
            >
              내보내기
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Lorebook Settings Modal */}
      <LorebookSettingsModal
        isOpen={lorebookModalOpened}
        onClose={closeLorebookModal}
        chatRoom={chatRoom}
        initialOrderMode={lorebookOrderMode}
        onSave={handleSaveLorebookSettings}
      />

      {/* Chat Room Settings Modal */}
      <ChatRoomSettingsModal
        isOpen={chatRoomSettingsModalOpened}
        onClose={closeChatRoomSettingsModal}
        chatRoom={chatRoom}
        onSave={handleSaveChatRoomSettings}
      />

      {/* Conversion Modal */}
      <ConversionModal
        opened={conversionModalOpened}
        onClose={closeConversionModal}
        onConfirm={handleConvertChatRoom}
        fromType={conversionSettings?.fromType || 'group'}
        toType={conversionSettings?.toType || 'private'}
        characters={(chatRoom?.characters || []) as any}
        activeCharacterIds={chatRoom?.activeCharacterIds || []}
        isLoading={isConverting}
        auto={conversionSettings?.auto || false}
      />

      {/* 이미지 재성성 프롬프트 입력 모달 */}
      <Modal
        opened={isRegenerateImageModalOpen}
        onClose={() => setIsRegenerateImageModalOpen(false)}
        title="이미지 재성성 프롬프트 입력"
        centered
      >
        <Textarea
          label="새로운 프롬프트"
          placeholder="이미지 재성성을 위한 새로운 프롬프트를 입력하세요. 비워두면 기존 컨텍스트를 활용합니다."
          value={newRegeneratePrompt}
          onChange={(event) => setNewRegeneratePrompt(event.currentTarget.value)}
          minRows={3}
          rows={7}
          mb="md"
        />
        {regenerateImageInfo?.imageUrl && (
          <Image src={regenerateImageInfo.imageUrl} alt="Original Image" maw={200} mx="auto" mb="md" radius="sm" />
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setIsRegenerateImageModalOpen(false)}>취소</Button>
          <Button
            onClick={handleConfirmRegenerateImage}
            loading={isRegeneratingImage}
            leftSection={<IconPhotoEdit size={14}/>}
          >
            재성성
          </Button>
        </Group>
      </Modal>
    </AppShell>
  );
}