'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Container, Paper, Text, Group, Button, Loader, Stack } from '@mantine/core';
import { useParams, useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { db } from '@/firebase/config';
import { doc, getDoc, collection, query, orderBy, getDocs } from 'firebase/firestore';
import { IconArrowBack, IconAlertCircle } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';
import type { ChatRoom, Message, RoomUIConfig } from '@/types/chat';
import { normalizeRoomUI } from '@/types/chat';
import NovelChatShell from '@/components/chat/novel/NovelChatShell';
import NovelHeader from '@/components/chat/novel/NovelHeader';
import NovelMessageList from '@/components/chat/novel/NovelMessageList';
import { useAuth } from '@/contexts/AuthContext';
import styles from '@/components/chat/novel/novel.module.css';

export default function ShareChatRoomNovelPage() {
  const { roomId } = useParams();
  const router = useRouter();
  const { user } = useAuth();

  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [roomUI, setRoomUI] = useState<RoomUIConfig>(() => {
    const base = normalizeRoomUI();
    return { ...base, skin: 'novel' }; // novel 고정
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 공유 뷰 페이지네이션(아래로 진행)
  const PAGE_SIZE = 30;
  const [allMessages, setAllMessages] = useState<Message[]>([]);
  const [visibleCount, setVisibleCount] = useState<number>(0);
  const [hasMorePage, setHasMorePage] = useState<boolean>(false);
  const [isLoadingMorePage, setIsLoadingMorePage] = useState<boolean>(false);
  const didInitTopRef = useRef(false);

  const loadMoreDown = () => {
    if (!hasMorePage || isLoadingMorePage) return;
    setIsLoadingMorePage(true);
    const next = Math.min(visibleCount + PAGE_SIZE, allMessages.length);
    setMessages(allMessages.slice(0, next));
    setVisibleCount(next);
    setHasMorePage(next < allMessages.length);
    setIsLoadingMorePage(false);
  };

  // 공유 채팅 데이터 단발 로드
  useEffect(() => {
    if (!roomId) {
      setError('잘못된 접근입니다.');
      setLoading(false);
      return;
    }

    let active = true;
    const loadingTimeout = setTimeout(() => {
      if (!active) return;
      setLoading(false);
      setError('공유된 채팅방을 불러오는 중 시간 초과가 발생했습니다.');
    }, 15000);

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const roomDocRef = doc(db, 'sharedChatRooms', String(roomId));
        const roomDoc = await getDoc(roomDocRef);

        if (!roomDoc.exists()) {
          if (active) {
            setError('공유된 채팅방을 찾을 수 없습니다.');
            setLoading(false);
          }
          return;
        }

        const roomData = roomDoc.data() as any;

        if (!roomData || !roomData.name || !Array.isArray(roomData.messages)) {
          if (active) {
            setError('공유된 채팅방 데이터 형식이 올바르지 않습니다.');
            setLoading(false);
          }
          return;
        }

        const room: ChatRoom = {
          id: roomDoc.id,
          name: roomData.name,
          description: roomData.description || '',
          creatorId: roomData.creatorId || '',
          creatorName: roomData.creatorName || '',
          image: roomData.image || '',
          characterId: roomData.characterId,
          characterIds: roomData.characterIds || [],
          isGroupChat: roomData.isGroupChat || false,
          activeCharacterIds: roomData.activeCharacterIds || [],
          nextSpeakerIndex: typeof roomData.nextSpeakerIndex === 'number' ? roomData.nextSpeakerIndex : -1,
          isNSFW: !!roomData.isNSFW,
          lastUpdated:
            roomData.sharedAt?.toDate?.() ??
            roomData.lastUpdated?.toDate?.() ??
            (roomData.sharedAt || roomData.lastUpdated ? new Date(roomData.sharedAt || roomData.lastUpdated) : undefined),
          members: roomData.members || 0,
          tags: roomData.tags || [],
          characters: roomData.characters || [],
        };

        // 단일 채팅 호환 처리
        if (room.characters && room.characters.length > 0) {
          if (!room.isGroupChat && room.characterId) {
            room.character = room.characters.find((c: any) => c.id === room.characterId) || room.characters[0];
          } else if (!room.isGroupChat && !room.character) {
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
            console.warn('[share/novel] Failed to fetch original room messages, falling back to embedded messages:', e);
          }
        }

        const embeddedSharedMessages: Message[] = (roomData.messages || []).map((m: any) => ({
          ...m,
          timestamp: m.timestamp?.toDate?.() ? m.timestamp.toDate() : (m.timestamp ? new Date(m.timestamp) : new Date()),
        }));

        const finalMessages = fetchedMessages.length > 0 ? fetchedMessages : embeddedSharedMessages;

        if (!active) return;

        // 초기 가시 범위를 설정하여 아래로 인피니티 스크롤
        setChatRoom(room);
        setAllMessages(finalMessages);
        const initial = Math.min(PAGE_SIZE, finalMessages.length);
        setMessages(finalMessages.slice(0, initial));
        setVisibleCount(initial);
        setHasMorePage(finalMessages.length > initial);

        // novel 고정 UI (roomData.ui가 있더라도 skin은 novel로 강제)
        const normalized = normalizeRoomUI(roomData.ui ?? undefined);
        setRoomUI({ ...normalized, skin: 'novel' });
      } catch (e) {
        console.error('Error fetching shared chat (novel):', e);
        if (active) setError('공유된 채팅방 정보를 불러오는 중 오류가 발생했습니다.');
      } finally {
        if (active) {
          clearTimeout(loadingTimeout);
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      clearTimeout(loadingTimeout);
    };
  }, [roomId]);

  // 공유 novel 뷰: 초기 로드 후 1회만 스크롤을 맨 위로 이동
  useEffect(() => {
    if (!didInitTopRef.current) {
      const el = document.querySelector(`.${styles.shell}`) as HTMLElement | null;
      el?.scrollTo({ top: 0, behavior: 'auto' });
      didInitTopRef.current = true;
    }
  }, [messages.length]);

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
              <Group gap="xs">
                <IconAlertCircle size={32} />
                <Text c="red">오류</Text>
              </Group>
              <Text ta="center">{error}</Text>
              <Group mt="md">
                <Button onClick={() => router.push('/')} leftSection={<IconArrowBack size={16} />}>
                  홈으로 가기
                </Button>
              </Group>
            </Stack>
          </Paper>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Container size="fluid" px={{ base: 0, sm: 'md' }} py="md">
        <NovelChatShell
          ui={roomUI}
          header={
            <NovelHeader
              title={chatRoom?.name}
              subtitle={chatRoom?.description}
              ui={roomUI}
              onShare={() => {
                const shareUrl = `${window.location.origin}/chat/share/novel/${roomId}`;
                navigator.clipboard.writeText(shareUrl)
                  .then(() => notifications.show({ title: '링크 복사 완료', message: '공유 링크가 복사되었습니다.', color: 'green' }))
                  .catch(() => notifications.show({ title: '링크 복사 실패', message: '클립보드 복사 중 오류가 발생했습니다.', color: 'red' }));
              }}
              // novel 전용 뷰이므로 스킨 변경은 제공하지 않음
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
              onLoadMore={loadMoreDown}
              hasMore={hasMorePage}
              isLoadingMore={isLoadingMorePage}
              infiniteDirection="down"
              initialScroll="top"
            />
          </div>
        </NovelChatShell>
      </Container>
    </AppShell>
  );
}