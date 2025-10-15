'use client';
import React from 'react';
import type { ChatSkin, RoomUIConfig } from '@/types/chat';
import { Group, Text, Select, Stack, Avatar, ActionIcon, Box, Menu, TextInput } from '@mantine/core';
import { IconDots, IconArrowLeft, IconBook, IconCheck, IconPencil, IconX, IconShare, IconTransform, IconDownload, IconTrash } from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import styles from './novel.module.css';

interface NovelHeaderProps {
  title?: string;
  subtitle?: string;
  description?: string;
  image?: string;
  onSkinChange?: (v: ChatSkin) => void;
  onBack?: () => void;
  onSettings?: () => void;
  ui: RoomUIConfig;
  // 추가 기능
  onShare?: () => void;
  onConvertToGroupChat?: () => void;
  onOpenLorebookSettings?: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onNameChange?: (newName: string) => Promise<void> | void;
  isGroupChat?: boolean;
}

const NovelHeader: React.FC<NovelHeaderProps> = ({
  title,
  subtitle,
  description,
  image,
  onSkinChange,
  onBack,
  onSettings,
  ui,
  onShare,
  onConvertToGroupChat,
  onOpenLorebookSettings,
  onExport,
  onDelete,
  onNameChange,
  isGroupChat
}) => {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [isEditingName, setIsEditingName] = React.useState(false);
  const [editedName, setEditedName] = React.useState(title ?? '');
  const [savingName, setSavingName] = React.useState(false);

  React.useEffect(() => {
    setEditedName(title ?? '');
  }, [title]);

  const handleSaveName = async () => {
    if (!onNameChange) {
      setIsEditingName(false);
      return;
    }
    const newName = editedName.trim();
    if (!newName || newName === (title ?? '')) {
      setIsEditingName(false);
      setEditedName(title ?? '');
      return;
    }
    try {
      setSavingName(true);
      await onNameChange(newName);
    } finally {
      setSavingName(false);
      setIsEditingName(false);
    }
  };

  const handleCancelEdit = () => {
    setIsEditingName(false);
    setEditedName(title ?? '');
  };

  const renderMoreMenu = (iconSize: number = 18) => (
    (onShare || onConvertToGroupChat || onOpenLorebookSettings || onExport || onDelete) ? (
      <Menu shadow="md" width={220}>
        <Menu.Target>
          <ActionIcon variant="subtle" size="sm" aria-label="더보기">
            <IconDots size={iconSize} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {onShare && (
            <Menu.Item leftSection={<IconShare size={14} />} onClick={onShare}>
              채팅방 링크 공유
            </Menu.Item>
          )}
          {onConvertToGroupChat && !isGroupChat && (
            <Menu.Item leftSection={<IconTransform size={14} />} onClick={onConvertToGroupChat}>
              단체 채팅방으로 변환
            </Menu.Item>
          )}
          {onOpenLorebookSettings && (
            <Menu.Item leftSection={<IconBook size={14} />} onClick={onOpenLorebookSettings}>
              로어북 설정
            </Menu.Item>
          )}
          {onExport && (
            <Menu.Item leftSection={<IconDownload size={14} />} onClick={onExport}>
              채팅 내용 내보내기
            </Menu.Item>
          )}
          {onDelete && (
            <Menu.Item color="red" leftSection={<IconTrash size={14} />} onClick={onDelete}>
              채팅방 삭제
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    ) : null
  );

  return (
    <Box className={styles.novelHeader}>
      {isMobile ? (
        <>
          <Group justify="space-between" align="center" mb={0}>
            <Group gap="xs" align="center" wrap="nowrap" style={{ minWidth: 0 }}>
              {onBack && (
                <ActionIcon variant="default" size="sm" onClick={onBack} aria-label="뒤로가기">
                  <IconArrowLeft size={16} />
                </ActionIcon>
              )}
              {image && <Avatar src={image} size="sm" radius="xl" />}
              {onNameChange ? (
                isEditingName ? (
                  <Group gap="xs" align="center" wrap="nowrap">
                    <TextInput
                      value={editedName}
                      onChange={(e) => setEditedName(e.currentTarget.value)}
                      size="xs"
                      styles={{ input: { fontWeight: 600 } }}
                    />
                    <ActionIcon
                      variant="light"
                      color="green"
                      size="sm"
                      onClick={handleSaveName}
                      loading={savingName}
                      aria-label="이름 저장"
                    >
                      <IconCheck size={14} />
                    </ActionIcon>
                    <ActionIcon
                      variant="light"
                      color="red"
                      size="sm"
                      onClick={handleCancelEdit}
                      aria-label="취소"
                    >
                      <IconX size={14} />
                    </ActionIcon>
                  </Group>
                ) : (
                  <Group gap={4} align="center" wrap="nowrap">
                    <Text size="md" fw={600} truncate="end">{title ?? '제목'}</Text>
                    <ActionIcon
                      variant="subtle"
                      size="xs"
                      onClick={() => setIsEditingName(true)}
                      aria-label="이름 수정"
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                  </Group>
                )
              ) : (
                <Text size="md" fw={600} truncate="end">{title ?? '제목'}</Text>
              )}
            </Group>
            <Group gap="xs" align="center" wrap="nowrap" style={{ flexShrink: 0 }}>
              <Menu shadow="md" width={160}>
                <Menu.Target>
                  <ActionIcon variant="light" size="sm" aria-label="UI 스타일">
                    <IconBook size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>UI 스타일</Menu.Label>
                  <Menu.Item
                    leftSection={ui.skin === 'classic' ? <IconCheck size={14} /> : undefined}
                    onClick={() => onSkinChange?.('classic')}
                  >
                    classic
                  </Menu.Item>
                  <Menu.Item
                    leftSection={ui.skin === 'novel' ? <IconCheck size={14} /> : undefined}
                    onClick={() => onSkinChange?.('novel')}
                  >
                    novel
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
              {renderMoreMenu(18)}
            </Group>
          </Group>
        </>
      ) : (
        <>
          <Group justify="space-between" align="flex-start" mb="lg">
            {/* 왼쪽: 뒤로가기 버튼 */}
            {onBack && (
              <ActionIcon
                variant="subtle"
                color="white"
                size="lg"
                onClick={onBack}
                className={styles.headerButton}
              >
                <IconArrowLeft size={20} />
              </ActionIcon>
            )}
            
            {/* 오른쪽: 설정 버튼들 */}
            <Group gap="xs">
              <Select
                data={[
                  { value: 'classic', label: '클래식' },
                  { value: 'novel', label: '소설' },
                ]}
                value={ui.skin}
                onChange={(v) => {
                  if (v === 'classic' || v === 'novel') {
                    onSkinChange?.(v);
                  }
                }}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                w={100}
                size="xs"
                variant="filled"
                className={styles.skinSelector}
              />
              
              {renderMoreMenu(20)}
            </Group>
          </Group>

          {/* 프로젝트 정보 섹션 */}
          <Box className={styles.projectInfo}>
            <Group align="flex-start" gap="md">
              {/* 프로젝트 텍스트 정보 - 프로필 이미지 제거 */}
              <Box className={styles.headerTextContainer}>
                <Text size="xl" fw={700} className={styles.headerTitle} mb={4}>
                  {title ?? ''}
                </Text>
                <Text size="sm" className={styles.headerSubtitle} mb={8}>
                  {subtitle ?? ''}
                </Text>
                <Text size="xs" className={styles.headerDescription} lh={1.4}>
                  {description ?? ''}
                </Text>
              </Box>
            </Group>
          </Box>
        </>
      )}
    </Box>
  );
};

export default NovelHeader;