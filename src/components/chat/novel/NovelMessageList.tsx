'use client';
import React, { useEffect, useRef, useState } from 'react';
import { Box, Loader } from '@mantine/core';
import type { RoomUIConfig } from '@/types/chat';
import NovelMessageItem from './NovelMessageItem';
import styles from './novel.module.css';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';

interface NovelMessageListProps {
  messages: any[];
  ui: RoomUIConfig;

  // 캐릭터 정보
  characters?: Array<{
    id: string;
    name: string;
    additionalImages?: string[];
    [key: string]: any;
  }>;

  // 메시지 옵션 기능들
  currentUserId?: string | null;
  onEditMessage?: (messageId: string, text: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onRerollMessage?: (messageId: string) => void;
  onForkMessage?: (messageId: string, description?: string) => Promise<void>;
  onRegenerateImage?: (messageId: string, imageUrl: string | undefined, currentPrompt?: string) => void;

  // 상태 관리
  rerollingMessageId?: string | null;
  regeneratingImageId?: string | null;
  isRerollingMessage?: boolean;
  isForkLoading?: boolean;

  // 인피니티 스크롤
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;

  // 스크롤 방향: 기본 'up'(상단 도달 시 로드), 공유 뷰에서는 'down'
  infiniteDirection?: 'up' | 'down';
  // 초기 스크롤 위치: 기본 bottom, 공유 뷰에서는 top
  initialScroll?: 'top' | 'bottom';
}

const NovelMessageList: React.FC<NovelMessageListProps> = ({
  messages,
  ui,
  characters,
  currentUserId,
  onEditMessage,
  onDeleteMessage,
  onRerollMessage,
  onForkMessage,
  onRegenerateImage,
  rerollingMessageId,
  regeneratingImageId,
  isRerollingMessage,
  isForkLoading,
  onLoadMore,
  hasMore = false,
  isLoadingMore = false,
  infiniteDirection = 'up',
  initialScroll = 'bottom',
}) => {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // 초기 스크롤 위치: 'top'이면 atBottom=false로 시작하여 followOutput 방지
  const [atBottom, setAtBottom] = useState(initialScroll !== 'top');
  const SCROLL_DELAY_MS = 1500;
  const initialScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 소설 모드 셸(.shell)을 스크롤 부모로 사용
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.querySelector(`.${styles.shell}`) as HTMLElement | null;
    setScrollParent(el || null);
  }, []);

  const BASE_INDEX = 1000000;
  const [firstItemIndex, setFirstItemIndex] = useState(() => Math.max(0, BASE_INDEX - (messages?.length ?? 0)));

  const prevLenRef = useRef<number>(messages.length);
  const prevFirstIdRef = useRef<string | undefined>(messages[0]?.id);
  const prevLastIdRef = useRef<string | undefined>(messages[messages.length - 1]?.id);

  useEffect(() => {
    const prevLen = prevLenRef.current ?? 0;
    const len = messages.length;

    if (len === 0) {
      setFirstItemIndex(Math.max(0, BASE_INDEX));
    } else if (prevLen === 0 && len > 0) {
      setFirstItemIndex(Math.max(0, BASE_INDEX - len));
      // 초기 로드 시 원하는 위치로 이동 (지연 적용)
      requestAnimationFrame(() => {
        if (initialScrollTimerRef.current) {
          clearTimeout(initialScrollTimerRef.current as any);
          initialScrollTimerRef.current = null;
        }
        initialScrollTimerRef.current = setTimeout(() => {
          if (initialScroll === 'bottom') {
            virtuosoRef.current?.scrollToIndex({ index: len - 1, behavior: 'auto', align: 'end' });
          } else {
            virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto', align: 'start' });
          }
        }, SCROLL_DELAY_MS);
      });
    } else if (len > prevLen) {
      const delta = len - prevLen;
      const prevFirst = prevFirstIdRef.current;
      if (prevFirst && messages[delta]?.id === prevFirst) {
        setFirstItemIndex((v) => Math.max(0, v - delta));
      } else {
        // append; let followOutput handle if at bottom
      }
    } else if (len < prevLen && len >= 0) {
      // list replaced or shrunk
      setFirstItemIndex(Math.max(0, BASE_INDEX - len));
    }

    prevLenRef.current = len;
    prevFirstIdRef.current = messages[0]?.id;
    prevLastIdRef.current = messages[len - 1]?.id;
  }, [messages]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (initialScrollTimerRef.current) {
        clearTimeout(initialScrollTimerRef.current as any);
        initialScrollTimerRef.current = null;
      }
    };
  }, []);

  return (
    <Box className={styles.messageListContainer} style={{ width: '100%' }}>
      <Virtuoso
        ref={virtuosoRef}
        customScrollParent={scrollParent ?? undefined}
        data={messages}
        firstItemIndex={firstItemIndex}
        computeItemKey={(index, m: any) => m?.id ?? `idx-${index}`}
        atBottomStateChange={setAtBottom}
        followOutput={atBottom ? 'smooth' : false}
        startReached={() => {
          if (infiniteDirection !== 'down') {
            if (onLoadMore && hasMore && !isLoadingMore) onLoadMore();
          }
        }}
        endReached={() => {
          if (infiniteDirection === 'down') {
            if (onLoadMore && hasMore && !isLoadingMore) onLoadMore();
          }
        }}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        components={{
          Header: () =>
            isLoadingMore ? (
              <Box ta="center" py="sm">
                <Loader size="xs" />
              </Box>
            ) : null,
          EmptyPlaceholder: () => (
            <Box ta="center" py="md" c="dimmed">
              메시지가 없습니다.
            </Box>
          ),
        }}
        itemContent={(index, m: any) => (
          <NovelMessageItem
            message={m}
            ui={ui}
            characters={characters}
            currentUserId={currentUserId}
            onEditMessage={onEditMessage}
            onDeleteMessage={onDeleteMessage}
            onRerollMessage={onRerollMessage}
            onForkMessage={onForkMessage}
            onRegenerateImage={onRegenerateImage}
            rerollingMessageId={rerollingMessageId}
            regeneratingImageId={regeneratingImageId}
            isRerollingMessage={isRerollingMessage}
            isForkLoading={isForkLoading}
          />
        )}
      />
    </Box>
  );
};

export default NovelMessageList;