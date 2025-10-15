'use client';
import React, { useEffect, useState } from 'react';
import { Menu, ActionIcon, Tooltip, Group, Text, Box, Image, Button, useMantineColorScheme } from '@mantine/core';
import { IconDots, IconEdit, IconTrash, IconGitBranch, IconRefresh, IconPhotoEdit } from '@tabler/icons-react';
import { Timestamp, doc, getDoc } from 'firebase/firestore';
import styles from './novel.module.css';
import type { RoomUIConfig } from '@/types/chat';
import { resolveEmotionFromText, selectAdditionalImageByEmotion, selectGalleryImageByEmotion } from '@/utils/gallery';
import type { GallerySelectable } from '@/utils/gallery';
import { useSettings } from '@/contexts/SettingsContext';
import { db } from '@/firebase/firebase';

interface NovelMessageItemProps {
  // 확장된 메시지 타입
  message: {
    id?: string;
    role?: 'assistant' | 'system' | 'user' | string;
    text?: string | null;
    imageUrl?: string | null;
    caption?: string | null;
    senderName?: string;
    senderId?: string;
    isCharacter?: boolean;
    characterId?: string;
    emotion?: string;
    timestamp?: Timestamp | Date | string | number | null;
    generatedImageUrl?: string | null;
    imageGenPrompt?: string | null;
    imageError?: boolean;
    isLoading?: boolean;
  };
  ui: RoomUIConfig;
  
  // 캐릭터 정보
  characters?: Array<{
    id: string;
    name: string;
    additionalImages?: string[];
    [key: string]: any;
  }>;
  
  // 메시지 옵션 함수들
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
}

const NovelMessageItem: React.FC<NovelMessageItemProps> = ({
  message,
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
  isForkLoading
}) => {
  const role = message.role ?? 'assistant';
  const isNarrative = role === 'assistant' || role === 'system';
  const isUser = !isNarrative;
  
  // 호버 상태 관리
  const [isHovered, setIsHovered] = useState(false);

  // Theme & settings-based text colors
  const { colorScheme } = useMantineColorScheme();
  const { settings } = useSettings();
  const defaultTextColors = {
    light: { normal: '#000000', italic: '#000000', bold: '#000000' },
    dark: { normal: '#ffffff', italic: '#ffffff', bold: '#ffffff' },
  };
  const tc = settings.textColors || defaultTextColors;
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const normalColor = tc[scheme].normal;
  const italicColor = tc[scheme].italic;
  const boldColor = tc[scheme].bold;

  // 캐릭터 갤러리(items with tags)를 Firestore에서 불러와 우선 사용
  const [galleryItems, setGalleryItems] = useState<GallerySelectable[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadGallery = async () => {
      try {
        if (!message.isCharacter || !message.characterId) return;
        const ref = doc(db, 'galleries', message.characterId);
        const snap = await getDoc(ref);
        if (cancelled) return;
        const data = snap.exists() ? (snap.data() as any) : null;
        const items = Array.isArray(data?.items) ? (data.items as GallerySelectable[]) : [];
        setGalleryItems(items);
      } catch (e) {
        console.error('Failed to load gallery items for character:', message.characterId, e);
        if (!cancelled) setGalleryItems([]);
      }
    };

    loadGallery();
    return () => {
      cancelled = true;
    };
  }, [message.isCharacter, message.characterId]);

  // 감정에 따른 캐릭터 이미지 선택
  const getCharacterImageByEmotion = () => {
    // characters 전달 여부와 무관하게 갤러리 우선 사용해야 하므로 characters를 필수로 요구하지 않음
    if (!message.isCharacter || !message.characterId) {
      return null;
    }

    // 메시지에서 감정 추출 (직접 제공된 emotion 우선, 없으면 텍스트에서 추출)
    const emotion = message.emotion || resolveEmotionFromText(message.text || '');

    // 결정적 선택을 위한 seed
    const seed = `${message.id || ''}|${message.characterId || ''}|${emotion || ''}`;

    // 1) 갤러리 아이템(태그 포함)을 우선 사용 (설정에서 숨김이 아닐 때만)
    if (!settings.hideImages && galleryItems && galleryItems.length > 0) {
      const byGallery = selectGalleryImageByEmotion(emotion, galleryItems, seed);
      if (byGallery) return byGallery;
    }

    // 2) 폴백: 추가 이미지 URL 배열에서 감정/태그 매칭 (characters prop이 제공된 경우에만)
    const character = characters?.find(c => c.id === message.characterId);
    if (character?.additionalImages && character.additionalImages.length > 0) {
      const byAdditional = selectAdditionalImageByEmotion(
        emotion,
        character.additionalImages,
        seed,
        { characterTags: Array.isArray((character as any).tags) ? (character as any).tags as string[] : undefined }
      );
      if (byAdditional) return byAdditional;
    }

    return null;
  };

  // 타임스탬프 포맷팅 함수
  const formatMessageTime = (timestamp: Timestamp | Date | string | number | null | undefined) => {
    let date: Date;
    try {
      if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp && typeof timestamp.toDate === 'function') {
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else if (typeof timestamp === 'string' || typeof timestamp === 'number') {
        date = new Date(timestamp);
      } else {
        date = new Date();
      }
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return '';
    }
  };

  // HTML 콘텐츠를 안전하게 처리하는 함수
  const processMessageText = (text: string | null): string => {
    if (!text) return '';

    // 0) Tag/Emotion 패턴 제거 (메시지 화면에 보이지 않게)
    let processedText = String(text).replace(/^\s*-?\s*(?:Tag|Emotion):.*$/gim, '');

    // 기본적인 HTML 태그들을 허용하되, 스크립트 등 위험한 태그는 제거
    const allowedTags = ['p', 'br', 'strong', 'em', 'u', 'i', 'b', 'span', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'code', 'pre'];
    
    // 스크립트 태그 제거
    processedText = processedText.replace(/<script[^>]*>.*?<\/script>/gi, '');
    
    // 이벤트 핸들러 제거
    processedText = processedText.replace(/on\w+="[^"]*"/gi, '');

    // img 태그 완전 제거 (self-closing 및 잘못 닫힌 케이스 포함)
    // React 오류 방지: img는 void 요소이므로 children 또는 innerHTML을 가질 수 없음
    // - <img ...>내용</img> 형태도 모두 제거
    processedText = processedText.replace(/<img\b[^>]*>(?:[\s\S]*?<\/img>)?/gi, '');
    processedText = processedText.replace(/<img\b[^>]*\/?>/gi, '');

    const lines = text.split('\n');
    let lastHeaderLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      // "## " (공백 포함) 또는 "---" 로 시작하는 줄을 헤더로 간주합니다.
      if (/^\s*##/.test(lines[i]) || lines[i].startsWith('---')) {
        lastHeaderLineIndex = i;
      }
    }

    if (lastHeaderLineIndex !== -1) {
      // 마지막 헤더 줄 다음부터의 텍스트를 가져옵니다.
      processedText = lines.slice(lastHeaderLineIndex + 1).join('\n').trim();
    }
    // 헤더가 없는 경우, processedText는 원본 text가 됩니다.
    // 이 경우, "## 일반 텍스트"와 같은 줄은 제거되지 않고 그대로 표시될 수 있습니다.
    // 사용자의 피드백은 특정 헤더 이후의 내용에 초점을 맞추고 있으므로, 이 동작이 의도된 것일 수 있습니다.
    
    // 두 개 이상의 별표로 감싼 텍스트를 굵게 처리 (공백 허용, 양쪽 별표 수 동일)
    processedText = processedText.replace(/(\*{2,})\s*([\s\S]*?)\s*\1/g, (_m, _stars, inner) => `<strong style="color: ${boldColor}">${String(inner).replace(/:/g, '')}</strong>`);
    // 단일 별표 이탤릭 처리(연속 ** 이상 제외): 앞뒤가 *이 아닌 경우만 매칭, 줄바꿈 포함 비탐욕
    processedText = processedText.replace(/(^|[^*])\*([\s\S]*?)\*(?!\*)/g, (_m, p1, p2) => `${p1}<em style="color: ${italicColor}">${String(p2).replace(/:/g, '')}</em>`);

    // 개행 문자를 <br /> 태그로 변환
    processedText = processedText.replace(/\n/g, '<br />');

    return processedText;
  };

  // 포크 핸들러
  const handleForkClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!onForkMessage || !message.id || isRerollingMessage || isForkLoading) return;
    
    try {
      await onForkMessage(message.id);
    } catch (error) {
      console.error('포크 생성 중 오류:', error);
    }
  };

  // 메시지 옵션 메뉴 렌더링
  const renderMessageOptions = () => {
    // 옵션을 표시할 조건: 현재 사용자 메시지이거나 캐릭터 메시지
    if (!message.id) return null;

    return (
      <Group
        gap="xs"
        className={`${styles.messageOptions} ${styles.messageOptionsOverlay}`}
        data-hovered={isHovered}
      >
        {/* 포크 버튼 (호버 시 표시) */}
        {onForkMessage && (message.isCharacter) && (
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
              disabled={isRerollingMessage || isForkLoading}
              onClick={handleForkClick}
              className={styles.optionButton}
            >
              <IconGitBranch size={16} />
            </ActionIcon>
          </Tooltip>
        )}

        {/* 메뉴 버튼 */}
        <Menu position="bottom-end" shadow="md">
          <Menu.Target>
            <ActionIcon
              variant="subtle"
              size="sm"
              className={styles.optionButton}
            >
              <IconDots size={16} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {/* 편집 */}
            {onEditMessage && (
              <Menu.Item
                leftSection={<IconEdit size={14} />}
                onClick={() => onEditMessage(message.id!, message.text || '')}
              >
                수정
              </Menu.Item>
            )}
            
            {/* 삭제 */}
            {onDeleteMessage && (
              <Menu.Item
                color="red"
                leftSection={<IconTrash size={14} />}
                onClick={() => onDeleteMessage(message.id!)}
              >
                삭제
              </Menu.Item>
            )}
            
            {/* 재생성 (캐릭터 메시지만) */}
            {onRerollMessage && message.isCharacter && (
              <Menu.Item
                leftSection={<IconRefresh size={14} />}
                onClick={() => onRerollMessage(message.id!)}
                disabled={isRerollingMessage}
              >
                재생성
              </Menu.Item>
            )}
            
            {/* 포크 */}
            {onForkMessage && (
              <Menu.Item
                leftSection={<IconGitBranch size={14} />}
                onClick={handleForkClick}
                disabled={isRerollingMessage || isForkLoading}
              >
                포크
              </Menu.Item>
            )}
            
            {/* 이미지 재생성/생성 (캐릭터 메시지만) */}
            {onRegenerateImage && message.isCharacter && (
              <Menu.Item
                leftSection={<IconPhotoEdit size={14} />}
                onClick={() => {
                  if (onRegenerateImage && message.id) {
                    onRegenerateImage(message.id, message.generatedImageUrl ?? undefined, message.imageGenPrompt ?? undefined);
                  }
                }}
                disabled={regeneratingImageId === message.id}
              >
                {message.generatedImageUrl ? "이미지 재생성" : "이미지 생성"}
              </Menu.Item>
            )}
          </Menu.Dropdown>
        </Menu>
      </Group>
    );
  };

  if (isNarrative) {
    return (
      <Box
        className={`${styles.narrativeContainer} ${styles.messageOptionsContainer}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 메시지 옵션 */}
        {renderMessageOptions()}
        
        {/* 캐릭터 이름과 시간 표시 */}
        {(message.senderName || message.timestamp) && (
          <Box className={styles.characterName}>
            {message.senderName && `▶ ${message.senderName}의 시점`}
            {message.timestamp && (
              <Text size="xs" c="dimmed" component="span" className={styles.timestampSpacing}>
                {formatMessageTime(message.timestamp)}
              </Text>
            )}
          </Box>
        )}
        
        <Box className={styles.narrative} style={{ color: normalColor }}>
          {/* 로딩 상태 표시 */}
          {(message.isLoading || rerollingMessageId === message.id) ? (
            <Box className={styles.loadingContainer}>
              <Group gap="xs">
                <Box className={styles.loadingSpinner} />
                <Text size="sm" c="dimmed">
                  {rerollingMessageId === message.id ? '응답 재생성 중...' : '입력 중...'}
                </Text>
              </Group>
            </Box>
          ) : message.text ? (
            <Box
              dangerouslySetInnerHTML={{
                __html: processMessageText(message.text)
              }}
            />
          ) : null}
          
          {/* 이미지 표시는 "봇 응답이 완료된 후"에만 */}
          {(() => {
            if (!message.isCharacter) return null;
            // isFinal이 true가 아니면 이미지 표시 안 함
            const isFinal = (message as any).isFinal ?? true; // 공유 등 경로에서 필드가 없을 수 있어 기본 true로 가정
            if (!isFinal) return null;

            // 설정에서 이미지 숨김이면 표시하지 않음
            if ((settings as any).hideImages) return null;

            // 설정에서 이미지 숨김이면 표시하지 않음
            if ((settings as any).hideImages) return null;

            // Novel: 캐릭터 고유 갤러리 우선. 생성 이미지 > 갤러리/추가이미지 > (페이지 계산)displayImageUrl > 첨부 이미지
            const emotionImage = getCharacterImageByEmotion();
            const finalUrl =
              (message as any).generatedImageUrl
              ?? emotionImage
              ?? (message as any).displayImageUrl
              ?? (message as any).imageUrl
              ?? null;

            if (!finalUrl) return null;

            return (
              <Box className={styles.imageContainer}>
                <Image
                  className={`${styles.msgImage} ${styles.clickableImage}`}
                  src={finalUrl}
                  alt={message.generatedImageUrl ? '생성된 장면' : emotionImage ? '캐릭터 감정' : '장면'}
                  onClick={() => {
                    window.open(finalUrl, '_blank');
                  }}
                />
                {!message.generatedImageUrl && !emotionImage && message.caption && (
                  <Box className={styles.caption}>
                    {message.caption}
                  </Box>
                )}
              </Box>
            );
          })()}
          
          {/* 이미지 생성 오류 표시 */}
          {message.imageError && (
            <Box
              className={styles.imageErrorContainer}
              onClick={() => {
                if (onRegenerateImage && message.id) {
                  onRegenerateImage(message.id, undefined, message.imageGenPrompt ?? undefined);
                }
              }}
            >
              <Group gap="xs" justify="center">
                <IconPhotoEdit size={20} color="red" />
                <Text size="sm" c="red">이미지 생성 실패 (클릭하여 재시도)</Text>
              </Group>
            </Box>
          )}
          
          {/* 이미지 재생성 중 표시 */}
          {regeneratingImageId === message.id && (
            <Box className={styles.imageLoadingContainer}>
              <Group gap="xs" justify="center">
                <Box className={styles.loadingSpinnerLarge} />
                <Text size="sm" c="dimmed">이미지 생성 중...</Text>
              </Group>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  if (isUser) {
    return (
      <Box
        className={`${styles.userMessageContainer} ${styles.messageOptionsContainer}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* 메시지 옵션 */}
        {renderMessageOptions()}
        
        <Box className={styles.userMessage}>
          {/* 시간 표시 */}
          {message.timestamp && (
            <Box className={styles.userMessageTimestamp}>
              <Text size="xs" c="dimmed">
                {formatMessageTime(message.timestamp)}
              </Text>
            </Box>
          )}
          
          <Box className={styles.userText} style={{ color: normalColor }}>
            {message.text ?? ''}
          </Box>
          
          {message.imageUrl && (
            <Box className={styles.userImageContainer}>
              <Image
                className={`${styles.userImage} ${styles.clickableImage}`}
                src={message.imageUrl}
                alt="사용자 업로드"
                onClick={() => window.open(message.imageUrl!, '_blank')}
              />
              {message.caption && (
                <Box className={styles.caption}>
                  {message.caption}
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // fallback
  return (
    <Box
      className={`${styles.narrative} ${styles.messageOptionsContainer}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {renderMessageOptions()}
      <Box style={{ color: normalColor }} dangerouslySetInnerHTML={{ __html: processMessageText(message.text ?? '') }} />
    </Box>
  );
};

export default NovelMessageItem;