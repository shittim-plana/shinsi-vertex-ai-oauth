'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Container, Paper, Text, Group, Button, Loader, Stack, Image as ThemeIcon, Box } from '@mantine/core';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext'; // Keep for user info in MessageList
import { db } from '@/firebase/config';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'firebase/firestore'; // Load full messages from original room
import { IconArrowBack, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import { AppShell } from '@/components/layout/AppShell';
import { Message, ChatRoom } from '@/types/chat';
import MessageList from '@/components/chat/MessageList';
import ChatHeader from '@/components/chat/ChatHeader';
import { normalizeRoomUI, type RoomUIConfig } from '@/types/chat';
import NovelChatShell from '@/components/chat/novel/NovelChatShell';
import NovelHeader from '@/components/chat/novel/NovelHeader';
import NovelMessageList from '@/components/chat/novel/NovelMessageList';
import ClassicChatShell from '@/components/chat/classic/ClassicChatShell';

export default function ShareChatRoomPage() {
  const { roomId } = useParams();
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomUI, setRoomUI] = useState<RoomUIConfig>(normalizeRoomUI());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { user } = useAuth(); // Needed for MessageList props
  const router = useRouter();
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const didInitTopRef = useRef(false);

  // 공유 뷰 페이지네이션(아래로 진행)
  const PAGE_SIZE = 30;
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [visibleCount, setVisibleCount] = useState<number>(0);
  const [hasMorePage, setHasMorePage] = useState<boolean>(false);
  const [isLoadingMorePage, setIsLoadingMorePage] = useState<boolean>(false);

  const loadMoreDown = () => {
    if (!hasMorePage || isLoadingMorePage) return;
    setIsLoadingMorePage(true);
    const next = Math.min(visibleCount + PAGE_SIZE, allMessages.length);
    setMessages(allMessages.slice(0, next));
    setVisibleCount(next);
    setHasMorePage(next < allMessages.length);
    setIsLoadingMorePage(false);
  };

  // Fetch shared chat room data (loads once)
  useEffect(() => {
    if (!roomId) {
        setError('잘못된 접근입니다.');
        setLoading(false);
        return;
    };

    const isActive = true; // Basic mount tracking
    const loadingTimeout = setTimeout(() => {
      if (isActive) {
        setLoading(false);
        setError('공유된 채팅방을 불러오는 중 시간 초과가 발생했습니다.');
      }
    }, 15000);

    const fetchSharedChat = async () => {
      try {
        setLoading(true);
        setError(null);

        const roomDocRef = doc(db, 'sharedChatRooms', String(roomId)); // Fetch from shared collection
        const roomDoc = await getDoc(roomDocRef);

        if (!roomDoc.exists()) {
          if (isActive) {
            setError('공유된 채팅방을 찾을 수 없습니다.');
          }
          return; // Stop execution if not found
        }

        const roomData = roomDoc.data();

        // Basic validation for shared data structure
        if (!roomData || !roomData.name || !Array.isArray(roomData.messages)) {
             if (isActive) {
                 setError('공유된 채팅방 데이터 형식이 올바르지 않습니다.');
             }
             return; // Stop execution if data is invalid
        }

        const room: ChatRoom = {
          id: roomDoc.id, // Use the shared doc ID
          name: roomData.name,
          description: roomData.description || '',
          creatorId: roomData.creatorId || '',
          creatorName: roomData.creatorName || '',
          image: roomData.image || '',
          characterId: roomData.characterId, // May not exist after conversion
          characterIds: roomData.characterIds || [],
          isGroupChat: roomData.isGroupChat || false,
          // These might not be relevant/accurate in shared view, but keep for type consistency
          activeCharacterIds: roomData.activeCharacterIds || [],
          nextSpeakerIndex: roomData.nextSpeakerIndex !== undefined ? roomData.nextSpeakerIndex : -1,
          isNSFW: roomData.isNSFW || false,
          lastUpdated: roomData.sharedAt && typeof roomData.sharedAt.toDate === 'function'
            ? roomData.sharedAt.toDate()
            : (roomData.lastUpdated && typeof roomData.lastUpdated.toDate === 'function'
              ? roomData.lastUpdated.toDate()
              : (roomData.sharedAt || roomData.lastUpdated ? new Date(roomData.sharedAt || roomData.lastUpdated) : undefined)), // Fallback to Date constructor or undefined
          members: roomData.members || 0,
          tags: roomData.tags || [],
          characters: roomData.characters || [], // Characters should be included in shared data
        };

         // Ensure character object exists if it's a single chat for consistency
         if (room.characters && room.characters.length > 0) { // Check if characters array exists and is not empty
             if (!room.isGroupChat && room.characterId) {
                 room.character = room.characters.find(c => c.id === room.characterId) || room.characters[0];
             } else if (!room.isGroupChat && !room.character) {
                 // Fallback if characterId is missing but characters array has one entry
                 room.character = room.characters[0];
             }
         }


        // Prefer loading the full messages from the ORIGINAL chat room collection
        const originalRoomId: string | null = (roomData as any).originalRoomId || null;

        let fetchedMessages: Message[] = [];
        if (originalRoomId) {
          try {
            const messagesColRef = collection(db, 'chatRooms', String(originalRoomId), 'messages');
            const q = query(messagesColRef, orderBy('timestamp', 'asc'));
            const snap = await getDocs(q);
            fetchedMessages = snap.docs.map((d) => {
              const data = d.data() as any;
              const ts =
                data.timestamp?.toDate
                  ? data.timestamp.toDate()
                  : (typeof data.timestamp === 'string' || typeof data.timestamp === 'number'
                      ? new Date(data.timestamp)
                      : new Date());
              const m: Message = {
                id: d.id,
                senderId: data.senderId,
                senderName: data.senderName,
                senderAvatar: data.senderAvatar || '',
                isCharacter: !!data.isCharacter,
                characterId: data.characterId || '',
                text: data.text,
                imageUrl: data.imageUrl || '',
                generatedImageUrl: data.generatedImageUrl ?? undefined,
                imageGenPrompt: data.imageGenPrompt ?? undefined,
                imageError: !!data.imageError,
                emotion: data.emotion ?? undefined,
                isFinal: data.isFinal ?? undefined,
                timestamp: ts,
              } as any;
              return m;
            });
          } catch (e) {
            console.warn('[share] Failed to fetch original room messages, falling back to snapshot messages:', e);
          }
        }

        // Fallback to embedded shared messages when original fetch failed or missing
        const embeddedSharedMessages: Message[] = (roomData.messages || []).map((msg: any) => ({
          ...msg,
          timestamp: msg.timestamp && typeof msg.timestamp.toDate === 'function'
            ? msg.timestamp.toDate()
            : (msg.timestamp ? new Date(msg.timestamp) : new Date()),
        }));

        const finalMessages = fetchedMessages.length > 0 ? fetchedMessages : embeddedSharedMessages;

        if (isActive) {
          // 초기 가시 범위를 설정하여 아래로 인피니티 스크롤
          setAllMessages(finalMessages);
          const initial = Math.min(PAGE_SIZE, finalMessages.length);
          setMessages(finalMessages.slice(0, initial));
          setVisibleCount(initial);
          setHasMorePage(finalMessages.length > initial);

          setChatRoom(room);
          // 공유 데이터에 ui가 없을 수 있으므로 기본값
          const normalized = normalizeRoomUI((roomData as any).ui ?? undefined);
          setRoomUI(normalized);
        }

      } catch (fetchError) {
        console.error('Error fetching shared chat room:', fetchError);
        if (isActive) {
          setError('공유된 채팅방 정보를 불러오는 중 오류가 발생했습니다.');
        }
      } finally {
        if (isActive) {
          clearTimeout(loadingTimeout);
          setLoading(false);
        }
      }
    };

    fetchSharedChat();

    // Cleanup function to clear timeout on unmount
    return () => {
        // isActive = false; // No longer needed as we don't re-assign
        clearTimeout(loadingTimeout); // Clear timeout on unmount
        clearTimeout(loadingTimeout); // Clear timeout on unmount as well
    };

  }, [roomId]); // Depend only on roomId

  // 공유뷰: 처음부터 읽을 수 있도록 최초 1회만 맨 위로 스크롤
  useEffect(() => {
    if (!didInitTopRef.current && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: 0, behavior: 'auto' });
      didInitTopRef.current = true;
    }
  }, [messages.length]); // 초기 메시지 로드 후 한 번만 상단으로 이동

  // Handle sharing the chat room link
  const handleShareChat = () => {
    const shareUrl = `${window.location.origin}/chat/share/${roomId}`;
    navigator.clipboard.writeText(shareUrl)
      .then(() => {
        notifications.show({
          title: '링크 복사 완료',
          message: '채팅방 링크가 클립보드에 복사되었습니다.',
          color: 'green',
        });
      })
      .catch(err => {
        console.error('Failed to copy chat link: ', err);
        notifications.show({
          title: '링크 복사 실패',
          message: '채팅방 링크를 복사하는 중 오류가 발생했습니다.',
          color: 'red',
        });
      });
  };

  // Loading and Error States
  if (loading) {
    return (
      <AppShell>
        <Container size="lg" py="xl">
          <Stack align="center">
            <Loader />
            <Text>공유된 채팅방을 불러오는 중...</Text>
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
              <ThemeIcon sizes="xl" radius="xl" variant="light" color="red">
                 <IconAlertCircle size={32} />
              </ThemeIcon>
              <Text c="red" ta="center">{error}</Text>
              <Group mt="md">
                <Button
                  onClick={() => router.push('/')} // Go to home on error in share view
                  leftSection={<IconArrowBack size={16} />}
                >
                  홈으로 가기
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Container>
      </AppShell>
    );
  }

  // Main Chat Room UI (Simplified)
  return (
    <AppShell>
      {/* Main Chat Area */}
      <Container size="fluid" px={{ base: 0, sm: 'md' }} py="md">
        {/* Risu 전용 분기 - 입력 UI 없음 */}
        {roomUI.skin === 'novel' ? (
          <NovelChatShell
            ui={roomUI}
            header={
              <NovelHeader
                title={chatRoom?.name}
                subtitle={chatRoom?.description}
                ui={roomUI}
                onSkinChange={(v) => setRoomUI((prev) => ({ ...prev, skin: v }))}
              />
            }
          >
            <div style={{ paddingTop: 8 }}>
              <NovelMessageList
                messages={messages.map((m) => ({
                  id: m.id,
                  role: (m as any).isCharacter ? 'assistant' : (((m as any).senderId === user?.uid) ? 'user' : 'assistant'),
                  text: (m as any).text,
                  // Novel 표시 우선순위: displayImageUrl > generatedImageUrl > additionalImage > imageUrl
                  imageUrl: (m as any).isCharacter ? ((m as any).displayImageUrl || undefined) : ((m as any).imageUrl || undefined),
                  displayImageUrl: (m as any).displayImageUrl,
                  generatedImageUrl: (m as any).generatedImageUrl ?? undefined,
                  imageGenPrompt: (m as any).imageGenPrompt ?? undefined,
                  isFinal: (m as any).isFinal ?? undefined,
                  caption: undefined,
                  senderName: (m as any).senderName,
                  senderId: (m as any).senderId,
                  characterId: (m as any).characterId,
                  emotion: (m as any).emotion,
                  timestamp: (m as any).timestamp,
                  isCharacter: (m as any).isCharacter,
                }))}
                ui={roomUI}
                characters={chatRoom?.characters}
              />
            </div>
          </NovelChatShell>
        ) : (
          <ClassicChatShell
            ui={roomUI}
            header={
              <ChatHeader
                chatRoom={chatRoom}
                router={router}
                onShare={handleShareChat}
                isShareView={true}
                setIsManageCharsModalOpen={() => {}}
                setIsDeleteConfirmModalOpen={() => {}}
                onConvertToGroupChat={() => {}}
                onImageChange={() => {}}
                isUploadingImage={false}
                onNameChange={async () => {}}
                ui={roomUI}
                onUpdateUI={(patch) => setRoomUI((prev) => ({ ...prev, ...patch }))}
              />
            }
          >
            <Box style={{ flex: 1, minHeight: 0 }}>
              <MessageList
                messages={messages}
                user={user}
                scrollAreaRef={scrollAreaRef}
                messagesEndRef={messagesEndRef}
                // Read-only props
                rerollingMessageId={null}
                handleEditMessage={() => {}}
                deleteMessage={() => {}}
                rerollMessage={() => {}}
                rerollingMessage={false}
                loadOlderMessages={loadMoreDown}
                hasMore={hasMorePage}
                isLoadingMore={isLoadingMorePage}
                initialScroll="top"
                infiniteDirection="down"
              />
            </Box>
          </ClassicChatShell>
      )}
      </Container>
    </AppShell>
  );
}
