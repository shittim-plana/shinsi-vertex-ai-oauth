'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Group, Avatar, Box, Text, Paper, Loader, Menu, ActionIcon, Image as MantineImage, useMantineTheme, useMantineColorScheme, Tooltip } from '@mantine/core';
import { IconDots, IconEdit, IconTrash, IconRefresh, IconPhotoEdit, IconAlertTriangle, IconGitBranch } from '@tabler/icons-react';
import type { Message } from '@/types/chat';
type User = any;
type FirebaseTimestamp = any;
import { useSettings } from '@/contexts/SettingsContext';
import ForkModal from './ForkModal';
import { resolveEmotionFromText, selectGalleryImageByEmotion } from '@/utils/gallery';
import type { GallerySelectable } from '@/utils/gallery';
import { db } from '@/firebase/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';

/**
 * Helper function to render text with italics and bold.
 * Allows passing custom colors per style via opts.
 */
const renderTextWithFormatting = (text: string, keyPrefix: string, opts?: { italicColor?: string; boldColor?: string }): React.ReactNode[] => {
  // 0) Tag/Emotion 패턴 제거 (메시지 화면에 보이지 않게)
  let processedText = String(text || '').replace(/^\s*-?\s*(?:Tag|Emotion):.*$/gim, '');

  // 1) 헤더 제거
  const lines = processedText.split('\n');
  let lastHeaderLineIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*##/.test(lines[i]) || lines[i].startsWith('---')) {
      lastHeaderLineIndex = i;
    }
  }
  processedText = lastHeaderLineIndex !== -1
    ? lines.slice(lastHeaderLineIndex + 1).join('\n').trim()
    : processedText;

  // 2) 특정 패턴 이후만 남기기
  const hidePatternRegex = /(?:반말|존댓말)\s+Response/i;
  const hidePattern = processedText.match(hidePatternRegex);
  if (hidePattern && hidePattern.index !== undefined) {
    processedText = processedText.slice(hidePattern.index + hidePattern[0].length);
  }

  // 3) 간단한 마크업 파서
  // 목표: 단일 * 로 이탤릭, 2개 이상 ** 로 볼드. 중첩 허용
  const nodes: React.ReactNode[] = [];
  let buf = '';
  let italic = false;
  let bold = false;

  const flush = (suffixKey: string) => {
    if (!buf) return;
    const content = buf.replace(/:/g, '');
    if (!content) { buf = ''; return; }
    nodes.push(
      <Text
        key={`${keyPrefix}-${suffixKey}-${nodes.length}`}
        component="span"
        fs={italic ? 'italic' as const : undefined}
        fw={bold ? 'bold' as const : undefined}
        c={bold ? opts?.boldColor : italic ? opts?.italicColor : undefined}
      >
        {content}
      </Text>
    );
    buf = '';
  };

  const n = processedText.length;
  let i = 0;
  while (i < n) {
    const ch = processedText[i];
    if (ch === '*') {
      // count consecutive *
      let j = i;
      while (j < n && processedText[j] === '*') j++;
      const k = j - i;

      // 토글 전에 버퍼 플러시
      flush(`seg-${i}`);

      if (k >= 2) {
        // *** => bold + italic 동시 토글, **** => bold만 토글(짝수), ***** => bold+italic ...
        bold = !bold;
        if (k % 2 === 1) {
          italic = !italic;
        }
      } else {
        // 단일 * => italic 토글
        italic = !italic;
      }
      i = j;
      continue;
    }
    buf += ch;
    i++;
  }
  flush('tail');

  // Text가 없는 경우에도 React.Fragment로 빈 배열 반환하지 않도록 처리
  return nodes.length ? nodes : [<React.Fragment key={`${keyPrefix}-empty`} />];
};

// Format timestamp (can be moved to utils)
const formatMessageTime = (timestamp: FirebaseTimestamp | Date | string | number | null | undefined) => {
  let date: Date;
  try {
    if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp && typeof (timestamp as any).toDate === 'function') {
      date = (timestamp as any).toDate();
    } else if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
      date = new Date(timestamp);
    } else {
      date = new Date(); // Fallback or consider showing invalid time
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (error) {
    console.error('Error formatting timestamp:', error);
    return '';
  }
};

interface MessageListProps {
  messages: Message[];
  user: User | null;
  scrollAreaRef: React.RefObject<HTMLDivElement | null>; // legacy prop 호환용
  messagesEndRef: React.RefObject<HTMLDivElement | null>; // legacy prop 호환용
  rerollingMessageId: string | null;
  handleEditMessage: (messageId: string, text: string) => void;
  deleteMessage: (messageId: string) => void;
  rerollMessage: (messageId: string) => void;
  rerollingMessage: boolean;
  loadOlderMessages: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  currentUserId?: string | null;
  handleRegenerateImage?: (messageId: string, imageUrl: string | undefined, currentPrompt?: string) => void;
  regeneratingImageId?: string | null;
  onFork?: (messageId: string, description?: string) => Promise<void>;
  /** 초기 스크롤 위치 제어: 기본 bottom (기존 동작), 공유뷰 등에서는 'top' 사용 */
  initialScroll?: 'top' | 'bottom';
  /** 인피니티 스크롤 방향: 기본 'up'(상단 도달 시 로드), 공유뷰에서는 'down' */
  infiniteDirection?: 'up' | 'down';
}

const MessageList: React.FC<MessageListProps> = ({
  messages,
  user,
  scrollAreaRef,
  currentUserId,
  messagesEndRef,
  rerollingMessageId,
  handleEditMessage,
  deleteMessage,
  rerollMessage,
  rerollingMessage,
  loadOlderMessages,
  hasMore,
  isLoadingMore,
  handleRegenerateImage,
  regeneratingImageId,
  onFork,
  initialScroll = 'bottom',
  infiniteDirection = 'up',
}) => {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  currentUserId = user?.uid || currentUserId || null;
  const { settings } = useSettings();

  // 호버 상태 관리 (메시지 ID를 키로 사용)
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);

  // 포크 관련 상태 관리
  const [modalOpened, setModalOpened] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMessageForFork, setSelectedMessageForFork] = useState<Message | null>(null);

  // 캐릭터 갤러리 캐시: characterId -> items
  const [galleryByCharacter, setGalleryByCharacter] = useState<Record<string, GallerySelectable[]>>({});

  // 메시지에 등장하는 캐릭터 ID 집합
  const characterIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of messages) {
      if ((m as any).isCharacter && (m as any).characterId) ids.add((m as any).characterId as string);
    }
    return Array.from(ids);
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const updates: Record<string, GallerySelectable[]> = {};
        for (const id of characterIds) {
          if (!id) continue;
          if (galleryByCharacter[id]) continue; // 이미 로드됨
          const ref = doc(db, 'galleries', id);
          const snap = await getDoc(ref);
          const data = snap.exists() ? (snap.data() as any) : null;
          const items = Array.isArray(data?.items) ? (data.items as GallerySelectable[]) : [];
          updates[id] = items;
        }
        if (!cancelled && Object.keys(updates).length > 0) {
          setGalleryByCharacter(prev => ({ ...prev, ...updates }));
        }
      } catch (e) {
        console.error('[MessageList] Failed to load galleries:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [characterIds, galleryByCharacter]);

  // 포크 핸들러 함수들
  const handleButtonClick = (e: React.MouseEvent, message: Message) => {
    e.stopPropagation();
    e.preventDefault();
    if (rerollingMessage || isLoading) return;

    setSelectedMessageForFork(message);
    setModalOpened(true);
  };

  const handleConfirm = async (description?: string) => {
    if (!selectedMessageForFork || !onFork) {
      console.error('[ERROR] handleConfirm: 필수 조건 누락', {
        selectedMessageForFork: !!selectedMessageForFork,
        onFork: !!onFork
      });
      return;
    }
    setIsLoading(true);
    try {
      await onFork(selectedMessageForFork.id, description);
      setModalOpened(false);
      setSelectedMessageForFork(null);
    } catch (error) {
      console.error('[ERROR] 분기 생성 중 오류:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setModalOpened(false);
    setSelectedMessageForFork(null);
  };

  // 메시지 미리보기
  const messagePreview = selectedMessageForFork?.text && selectedMessageForFork.text.length > 100
    ? selectedMessageForFork.text.substring(0, 100) + '...'
    : selectedMessageForFork?.text || '';

  // === react-virtuoso 상태 관리 ===
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // 초기 스크롤 위치: 'top'이면 atBottom=false로 시작하여 followOutput 방지
  const [atBottom, setAtBottom] = useState(initialScroll !== 'top');
  // firstItemIndex를 유지해서 상단 프리펜드 시 스크롤 위치를 보정
  const BASE_INDEX = 1000000;
  const [firstItemIndex, setFirstItemIndex] = useState(() => Math.max(0, BASE_INDEX - messages.length));
  const prevLengthRef = useRef<number>(messages.length);
  const prevFirstIdRef = useRef<string | null>(messages[0]?.id ?? null);
  const prevLastIdRef = useRef<string | null>(messages[messages.length - 1]?.id ?? null);

  // 초기 진입 및 데이터 변경 시 스크롤 관리
  useEffect(() => {
    const len = messages.length;
    const prevLen = prevLengthRef.current;
    const curFirstId = messages[0]?.id ?? null;
    const curLastId = messages[len - 1]?.id ?? null;
    const prevFirstId = prevFirstIdRef.current;
    const prevLastId = prevLastIdRef.current;

    // 초기 로드: 설정에 따라 맨 아래 또는 맨 위로 이동
    if (prevLen === 0 && len > 0) {
      if (initialScroll === 'bottom') {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({ index: len - 1, behavior: 'auto', align: 'end' });
        });
      } else {
        requestAnimationFrame(() => {
          virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'auto', align: 'start' });
        });
      }
    } else if (len > prevLen) {
      // 증가한 경우: 상단 프리펜드인지 하단 앱펜드인지 구분
      const isPrepended = curFirstId !== prevFirstId && prevFirstId !== null;
      if (isPrepended) {
        const delta = len - prevLen;
        setFirstItemIndex((v) => Math.max(0, v - delta)); // 상단에 추가된 개수만큼 보정(음수 방지)
      } else {
        // 새 메시지 도착 등으로 하단에 추가된 경우: 하단에 있을 때만 따라가기
        if (atBottom) {
          requestAnimationFrame(() => {
            virtuosoRef.current?.scrollToIndex({ index: len - 1, behavior: 'auto', align: 'end' });
          });
        }
      }
    }

    prevLengthRef.current = len;
    prevFirstIdRef.current = curFirstId;
    prevLastIdRef.current = curLastId;
  }, [messages, atBottom]);

  // Virtuoso Scroller를 외부 ref(scrollAreaRef)로 전달 (레거시 호환)
  const Scroller = React.useMemo(() => {
    return React.forwardRef<HTMLDivElement, React.HTMLProps<HTMLDivElement>>(function ScrollerImpl(props, ref) {
      const setRef = (el: HTMLDivElement | null) => {
        if (typeof ref === 'function') ref(el);
        else if (ref && typeof (ref as any) === 'object') (ref as any).current = el;
        if (scrollAreaRef && typeof scrollAreaRef === 'object') (scrollAreaRef as any).current = el;
      };
      // classic 모드 스크롤바 숨김을 위해 전역 클래스 적용 (실제 스크롤은 유지)
      const cls = props.className ? `${props.className} classic-scroller` : 'classic-scroller';
      return <div {...props} ref={setRef} className={cls} style={{ ...props.style, overflowY: 'auto' }} />;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollAreaRef]);

  return (
    <Box style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
      <Virtuoso<Message>
        ref={virtusoRef => {
          virtuosoRef.current = virtusoRef;
        }}
        style={{ height: '100%' }}
        data={messages}
        firstItemIndex={firstItemIndex}
        followOutput={atBottom} // 하단에 있을 때만 새 출력 따라가기
        atBottomStateChange={setAtBottom}
        startReached={() => {
          if (infiniteDirection !== 'down') {
            if (hasMore && !isLoadingMore) {
              loadOlderMessages();
            }
          }
        }}
        endReached={() => {
          if (infiniteDirection === 'down') {
            if (hasMore && !isLoadingMore) {
              loadOlderMessages();
            }
          }
        }}
        computeItemKey={(index, item) => item?.id ?? `idx-${index}`}
        increaseViewportBy={{ top: 600, bottom: 600 }}
        components={{
          Scroller,
          Header: () =>
            isLoadingMore ? (
              <Box px="md" py="xs">
                <Group justify="center"><Loader size="xs" /></Group>
              </Box>
            ) : null,
          Footer: () => <div ref={messagesEndRef as any} />,
          EmptyPlaceholder: () => (
            <Box style={{ height: '100%' }} px="md" py="md">
              <Group align="center" justify="center" style={{ height: '100%' }}>
                <Text c="dimmed">메시지가 없습니다. 대화를 시작해보세요!</Text>
              </Group>
            </Box>
          )
        }}
        itemContent={(index, message) => {
          const isPlayerMessage = (message as any).senderId === currentUserId;
          // Theme-aware text colors
          const defaultTextColors = {
            light: { normal: '#000000', italic: '#000000', bold: '#000000' },
            dark: { normal: '#ffffff', italic: '#ffffff', bold: '#ffffff' },
          };
          const tc = (settings as any).textColors ?? defaultTextColors;
          const scheme = colorScheme === 'dark' ? 'dark' : 'light';
          const baseTextColor = tc[scheme].normal;
          const italicTextColor = tc[scheme].italic;
          const boldTextColor = tc[scheme].bold;

          return (
            <Box px="md" py="sm"
              onMouseEnter={() => setHoveredMessageId(message.id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              <Group align="flex-start" gap="sm" justify={isPlayerMessage ? 'flex-end' : 'flex-start'}>
                {!isPlayerMessage && (
                  <Avatar
                    src={(message as any).personaAvatar || (message as any).senderAvatar || undefined}
                    alt={(message as any).senderName}
                    radius="xl"
                    size="xl"
                    color={(message as any).isCharacter ? 'blue' : 'gray'}
                  />
                )}

                <Box style={{ maxWidth: '80%' }}>
                  <Group align="center" mb={5} gap="xs" justify={isPlayerMessage ? 'flex-end' : 'flex-start'}>
                    {!isPlayerMessage && (
                      <Text fw={(message as any).isCharacter ? 700 : 500} size="sm" component="span">
                        {(message as any).senderName}
                      </Text>
                    )}
                    <Text size="xs" c="dimmed" component="span">
                      {formatMessageTime((message as any).timestamp)}
                    </Text>

                    {(isPlayerMessage || (message as any).isCharacter) && (
                      <Menu position="bottom-end" shadow="md">
                        <Menu.Target>
                          <ActionIcon variant="subtle" size="xs">
                            <IconDots size={14} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {(isPlayerMessage || (message as any).isCharacter) && (
                            <Menu.Item
                              leftSection={<IconEdit size={14} />}
                              onClick={() => handleEditMessage(message.id, (message as any).text)}
                            >
                              수정
                            </Menu.Item>
                          )}
                          {(isPlayerMessage || (message as any).isCharacter) && (
                            <Menu.Item
                              color="red"
                              leftSection={<IconTrash size={14} />}
                              onClick={() => deleteMessage(message.id)}
                            >
                              삭제
                            </Menu.Item>
                          )}
                          {(message as any).isCharacter && (
                            <Menu.Item
                              leftSection={<IconRefresh size={14} />}
                              onClick={() => rerollMessage(message.id)}
                              disabled={rerollingMessage}
                            >
                              재생성
                            </Menu.Item>
                          )}
                          {onFork && (isPlayerMessage || (message as any).isCharacter) && (
                            <Menu.Item
                              leftSection={<IconGitBranch size={14} />}
                              onClick={(e) => handleButtonClick(e, message)}
                              disabled={rerollingMessage || isLoading}
                            >
                              포크
                            </Menu.Item>
                          )}
                          {(message as any).isCharacter && (
                            <Menu.Item
                              leftSection={<IconPhotoEdit size={14} />}
                              onClick={() => {
                                if (handleRegenerateImage) {
                                  handleRegenerateImage(
                                    message.id,
                                    (message as any).generatedImageUrl ?? undefined,
                                    (message as any).imageGenPrompt ?? undefined
                                  );
                                } else {
                                  console.warn('[MessageList] handleRegenerateImage is not provided.');
                                }
                              }}
                              disabled={!handleRegenerateImage || regeneratingImageId === message.id}
                            >
                              {(message as any).generatedImageUrl ? '이미지 재생성' : '이미지 생성'}
                            </Menu.Item>
                          )}
                        </Menu.Dropdown>
                      </Menu>
                    )}

                    {onFork && (isPlayerMessage || (message as any).isCharacter) && hoveredMessageId === message.id && (
                      <Tooltip
                        label="이 지점에서 분기"
                        position="top"
                        withArrow
                        openDelay={500}
                      >
                        <ActionIcon
                          variant="subtle"
                          color="blue"
                          size="sm"
                          disabled={rerollingMessage || isLoading}
                          onClick={(e) => handleButtonClick(e, message)}
                          style={{
                            opacity: hoveredMessageId === message.id ? 1 : 0,
                            transition: 'opacity 0.2s ease',
                            cursor: (rerollingMessage || isLoading) ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <IconGitBranch size={16} />
                        </ActionIcon>
                      </Tooltip>
                    )}
                  </Group>

                  {/* Character generated image / gallery fallback */}
                  {(message as any).isCharacter && !settings.hideImages && (
                    <Box mb="xs" maw={300}>
                      {regeneratingImageId === message.id ? (
                        <Paper withBorder p="sm" radius="md" bg={colorScheme === 'dark' ? theme.colors.dark[5] : theme.colors.gray[1]}>
                          <Group gap="xs" justify="center">
                            <Loader size="sm" />
                            <Text size="sm" c="dimmed">이미지 생성 중...</Text>
                          </Group>
                        </Paper>
                      ) : (message as any).imageError ? (
                        <Paper
                          withBorder
                          p="sm"
                          radius="md"
                          bg={colorScheme === 'dark' ? theme.colors.red[9] : theme.colors.red[0]}
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            if (handleRegenerateImage) {
                              handleRegenerateImage(message.id, undefined, (message as any).imageGenPrompt ?? undefined);
                            } else {
                              console.warn('[MessageList] Error UI onClick: handleRegenerateImage is not provided.');
                            }
                          }}
                        >
                          <Group gap="xs" justify="center">
                            <IconAlertTriangle size={20} color={theme.colors.red[6]} />
                            <Text size="sm" c="red">이미지 생성 실패 (클릭하여 재시도)</Text>
                          </Group>
                        </Paper>
                      ) : (message as any).generatedImageUrl ? (
                        <MantineImage
                          src={(message as any).generatedImageUrl}
                          alt={'Message image'}
                          radius="xl"
                          style={{ cursor: 'pointer' }}
                          onClick={() => {
                            const url = (message as any).generatedImageUrl as string;
                            window.open(url, '_blank');
                          }}
                        />
                      ) : (() => {
                        if (settings.hideImages) return null;
                        const emotion = (message as any).emotion || resolveEmotionFromText((message as any).text || '');
                        const items = (message as any).characterId ? (galleryByCharacter[(message as any).characterId] || []) : [];
                        if (items.length === 0) return null;
                        const seed = `${message.id || ''}|${(message as any).characterId || ''}|${emotion || ''}`;
                        const url = selectGalleryImageByEmotion(emotion, items, seed);
                        if (!url) return null;
                        return (
                          <MantineImage
                            src={url}
                            alt={'Gallery image'}
                            radius="xl"
                            style={{ cursor: 'pointer' }}
                            onClick={() => {
                              window.open(url, '_blank');
                            }}
                          />
                        );
                      })()}
                    </Box>
                  )}

                  {/* Text content */}
                  {(((message as any).isLoading && !(message as any).isCharacter) ||
                    (rerollingMessageId === message.id && (message as any).isCharacter && !regeneratingImageId && !(message as any).imageError)) ? (
                    <Paper withBorder p="sm" radius="md" bg={colorScheme === 'dark' ? theme.colors.dark[5] : theme.colors.gray[1]}>
                      <Group gap="xs">
                        <Loader size="xs" />
                        <Text size="sm" c="dimmed">
                          {rerollingMessageId === message.id ? '응답 재생성 중...' : '입력 중...'}
                        </Text>
                      </Group>
                    </Paper>
                  ) : ((message as any).text && !((message as any).isCharacter && (regeneratingImageId === message.id || (message as any).imageError))) ? (
                    <Paper
                      withBorder={!(message as any).isCharacter && !isPlayerMessage}
                      p="sm"
                      radius="md"
                      bg={isPlayerMessage
                        ? (colorScheme === 'dark' ? theme.colors.blue[9] : theme.colors.blue[0])
                        : (colorScheme === 'dark' ? theme.colors.dark[8] : theme.white)
                      }
                      style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap', color: baseTextColor }}
                    >
                      {(() => {
                        const tc2 = (settings as any).textColors ?? { light: { normal: '#000000', italic: '#000000', bold: '#000000' }, dark: { normal: '#ffffff', italic: '#ffffff', bold: '#ffffff' } };
                        const scheme2 = colorScheme === 'dark' ? 'dark' : 'light';
                        const italicColor = tc2[scheme2].italic;
                        const boldColor = tc2[scheme2].bold;
                        const currentText = (message as any).text as string;

                        const elements: React.ReactNode[] = [];
                        let lastIndex = 0;
                        const imageRegex = /!\[(.*?)\]\((.*?)\)|(\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|webp|bmp)\b)/gi;
                        let match: RegExpExecArray | null;

                        while ((match = imageRegex.exec(currentText)) !== null) {
                          const fullMatch = match[0];
                          const altText = match[1] || 'image';
                          const imageUrl = match[2] || match[3];

                          if (match.index > lastIndex) {
                            elements.push(
                              ...renderTextWithFormatting(
                                currentText.substring(lastIndex, match.index),
                                `msg-${message.id}-pre-${match.index}`,
                                { italicColor, boldColor }
                              )
                            );
                          }

                          if (imageUrl) {
                            elements.push(
                              <Box key={`img-${match.index}`} my="xs">
                                <MantineImage
                                  src={imageUrl}
                                  alt={altText}
                                  radius="sm"
                                  maw={300}
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => window.open(imageUrl, '_blank')}
                                />
                              </Box>
                            );
                          }
                          lastIndex = match.index + fullMatch.length;
                        }

                        if (lastIndex < currentText.length) {
                          elements.push(
                            ...renderTextWithFormatting(
                              currentText.substring(lastIndex),
                              `msg-${message.id}-post`,
                              { italicColor, boldColor }
                            )
                          );
                        }

                        return elements.length > 0
                          ? elements
                          : renderTextWithFormatting(
                              (message as any).text,
                              `msg-${message.id}-full`,
                              { italicColor, boldColor }
                            );
                      })()}
                    </Paper>
                  ) : null}

                  {(message as any).imageUrl && (
                    <Box mt={(message as any).text ? 'xs' : 0} maw={300} style={{ marginLeft: isPlayerMessage ? 'auto' : 0 }}>
                      <MantineImage
                        src={(message as any).imageUrl}
                        alt="Attached image"
                        radius="md"
                        style={{ cursor: 'pointer' }}
                        onClick={() => window.open((message as any).imageUrl as string, '_blank')}
                      />
                    </Box>
                  )}
                </Box>

                {/* 오른쪽 플레이어 아바타 */}
                {isPlayerMessage && (message as any).senderAvatar && (
                  <Avatar
                    src={(message as any).senderAvatar}
                    alt={(message as any).senderName}
                    radius="xl"
                    size="xl"
                  />
                )}
              </Group>
            </Box>
          );
        }}
      />

      {/* ForkModal */}
      <ForkModal
        opened={modalOpened}
        onClose={handleClose}
        onConfirm={handleConfirm}
        messagePreview={messagePreview}
        isLoading={isLoading}
      />
    </Box>
  );
};

export default MessageList;
