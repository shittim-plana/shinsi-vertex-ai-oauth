import React, { useRef, useState, useEffect } from 'react'; // Import useRef, useState, useEffect
import { Text, Avatar, ActionIcon, Menu, Button, Loader, Box, TextInput, Group, Stack, Select } from '@mantine/core';
import { IconDots, IconTrash, IconUsersGroup, IconArrowLeft, IconShare, IconTransform, IconPhotoEdit, IconCheck, IconX, IconPencil, IconDownload, IconBook } from '@tabler/icons-react'; // Added IconBook
import { useRouter } from 'next/navigation';
import { useMediaQuery } from '@mantine/hooks';
import ForkIndicator from './ForkIndicator';
import BreadcrumbNavigation from './BreadcrumbNavigation';
import type { RoomUIConfig } from '@/types/chat';

// Local ChatRoom type definition (temporary)
interface ChatRoom {
  id: string;
  name: string;
  description?: string;
  image?: string;
  isGroupChat: boolean;
  ui?: RoomUIConfig;
  isFork?: boolean;
  parentRoomId?: string;
}

interface ChatHeaderProps {
  chatRoom: ChatRoom | null;
  router: ReturnType<typeof useRouter>;
  setIsManageCharsModalOpen: (isOpen: boolean) => void;
  setIsDeleteConfirmModalOpen: (isOpen: boolean) => void;
  onShare: () => void; // Add the onShare prop type
  onConvertToGroupChat: () => void; // Add prop for converting to group chat
  onImageChange: (file: File) => void; // Add prop for handling image change
  isUploadingImage: boolean; // Add prop for image upload loading state
  onNameChange: (newName: string) => Promise<void>;
  onExport?: () => void;
  onOpenLorebookSettings?: () => void; // 로어북 설정 모달 열기 함수 prop 추가 (선택적)
  isShareView?: boolean;
  // 신규: UI 스타일 변경 연동
  ui?: RoomUIConfig;
  onUpdateUI?: (patch: Partial<RoomUIConfig>) => void;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  chatRoom,
  router,
  setIsManageCharsModalOpen,
  setIsDeleteConfirmModalOpen,
  onShare,
  onConvertToGroupChat,
  onImageChange,
  isUploadingImage,
  onNameChange,
  onExport,
  onOpenLorebookSettings, // prop 추가
  isShareView = false,
  ui,
  onUpdateUI,
}) => {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(chatRoom?.name || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  // Update editedName when chatRoom.name changes (e.g., after initial load or external update)
  useEffect(() => {
    if (chatRoom?.name) {
      setEditedName(chatRoom.name);
    }
  }, [chatRoom?.name]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select(); // Select text for easy replacement
    }
  }, [isEditingName]);

  const fileInputRef = useRef<HTMLInputElement>(null); // Ref for file input

  const handleAvatarClick = () => {
    // Only allow image change in non-share view and if it's a group chat
    if (!isShareView && chatRoom?.isGroupChat && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImageChange(file);
      // Reset file input value to allow selecting the same file again
      event.target.value = '';
    }
  };

  const handleNameClick = () => {
    if (!isShareView) {
      setIsEditingName(true);
    }
  };

  const handleSaveName = async () => {
    if (!editedName.trim() || editedName.trim() === chatRoom?.name) {
      setIsEditingName(false);
      return;
    }
    setIsSavingName(true);
    try {
      await onNameChange(editedName.trim());
      setIsEditingName(false);
    } catch (error) {
      // Error handling is likely done in the parent component's onNameChange
      console.error("Error saving name (in ChatHeader):", error);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedName(chatRoom?.name || ''); // Reset to original name
  };

  const handleNameInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleSaveName();
    } else if (event.key === 'Escape') {
      handleCancelEditName();
    }
  };

  const handleBack = () => {
    // Navigate back to chat list or home depending on the view
    router.push(isShareView ? '/' : '/chat');
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', paddingBottom: isMobile ? '0.5rem' : '1rem' }}>
      {isMobile ? (
        <ActionIcon variant="default" onClick={handleBack} size="sm" mr="xs" aria-label="뒤로가기">
          <IconArrowLeft size={16} />
        </ActionIcon>
      ) : (
        <Button variant="default" onClick={handleBack} size="xs" mr="sm">
          <IconArrowLeft size={16} />
        </Button>
      )}
      {chatRoom && (
        <>
          <Box style={{ position: 'relative', cursor: (!isShareView && chatRoom?.isGroupChat) ? 'pointer' : 'default' }} onClick={handleAvatarClick}>
            <Avatar src={chatRoom.image} size={isMobile ? 'sm' : 'md'} radius="xl" />
            {isUploadingImage && (
              <Loader size="xs" style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }} />
            )}
            {!isShareView && chatRoom?.isGroupChat && !isUploadingImage && (
              <ActionIcon
                variant="filled"
                color="blue"
                size="xs"
                radius="xl"
                style={{ position: 'absolute', bottom: 0, right: 0, pointerEvents: 'none' }} // Prevent icon from blocking click
              >
                <IconPhotoEdit size={12} />
              </ActionIcon>
            )}
          </Box>
          <div style={{ flex: 1, marginLeft: isMobile ? '0.5rem' : '1rem' }}>
            {isEditingName ? (
              <Group gap="xs" wrap="nowrap" style={{ width: '100%', minWidth: 0 }}>
                <TextInput
                  ref={nameInputRef}
                  value={editedName}
                  onChange={(event) => setEditedName(event.currentTarget.value)}
                  onKeyDown={handleNameInputKeyDown}
                  size={isMobile ? 'sm' : 'lg'}
                  radius="xl"
                  variant="filled"
                  style={{ flex: 1 }}
                  disabled={isSavingName}
                  maxLength={50}
                />
                <ActionIcon onClick={handleSaveName} loading={isSavingName} variant="light" color="green" size={isMobile ? 'sm' : 'md'} radius="xl">
                  <IconCheck size={16} />
                </ActionIcon>
                <ActionIcon onClick={handleCancelEditName} variant="light" color="red" disabled={isSavingName} size={isMobile ? 'sm' : 'md'} radius="xl">
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            ) : (
              <Group gap="xs" wrap="nowrap" style={{ cursor: isShareView ? 'default' : 'pointer' }} onClick={handleNameClick}>
                <Text size={isMobile ? 'md' : 'lg'} fw={600} truncate="end">{chatRoom.name}</Text>
                {!isShareView && <IconPencil size={16} style={{ color: 'var(--mantine-color-dimmed)', flexShrink: 0 }} />}
              </Group>
            )}
            <Stack gap={4}>
              {!isMobile && <Text size="xs" c="dimmed">{chatRoom.description}</Text>}
              {/* 분기 정보 표시 */}
              {chatRoom.isFork && (
                <ForkIndicator chatRoom={chatRoom} compact />
              )}
              {/* 분기 체인 네비게이션 */}
              {(chatRoom.parentRoomId || chatRoom.isFork) && (
                <BreadcrumbNavigation currentRoom={chatRoom} />
              )}
            </Stack>
          </div>

          {/* UI 스타일 토글 - 모바일 최소화, 데스크톱은 Select */}
          {!isShareView && (
            isMobile ? (
              <Menu shadow="md" width={160}>
                <Menu.Target>
                  <ActionIcon variant="light" size="sm" mr="xs" aria-label="UI 스타일 변경">
                    <IconBook size={16} />
                  </ActionIcon>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Label>UI 스타일</Menu.Label>
                  <Menu.Item
                    leftSection={ui?.skin === 'classic' ? <IconCheck size={14} /> : undefined}
                    onClick={() => onUpdateUI?.({ skin: 'classic' })}
                  >
                    classic
                  </Menu.Item>
                  <Menu.Item
                    leftSection={ui?.skin === 'novel' ? <IconCheck size={14} /> : undefined}
                    onClick={() => onUpdateUI?.({ skin: 'novel' })}
                  >
                    novel
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            ) : (
              <Select
                label="UI 스타일"
                data={[
                  { value: 'classic', label: 'classic' },
                  { value: 'novel', label: 'novel' },
                ]}
                value={ui?.skin || 'classic'}
                onChange={(v) => {
                  if (v === 'classic' || v === 'novel') {
                    onUpdateUI?.({ skin: v });
                  }
                }}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
                w={140}
                size="xs"
                mr="xs"
              />
            )
          )}

          {!isEditingName && ( // Hide menu while editing name
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <ActionIcon variant="subtle">
                  <IconDots size={20} />
                </ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {/* Share Link Item - Always visible */}
                <Menu.Item
                  leftSection={<IconShare size={14} />}
                  onClick={onShare}
                >
                  채팅방 링크 공유
                </Menu.Item>

                {/* Conditional Items for Non-Share View */}
                {!isShareView && (
                  <>
                    {/* Manage Characters Item - Conditional (Group Chat) */}
                    {chatRoom?.isGroupChat && (
                      <Menu.Item
                        leftSection={<IconUsersGroup size={14} />}
                        onClick={() => setIsManageCharsModalOpen(true)}
                      >
                        캐릭터 관리
                      </Menu.Item>
                    )}

                    {/* Convert to Group Chat Item - Conditional (Single Chat) */}
                    {chatRoom && !chatRoom.isGroupChat && (
                      <Menu.Item
                        leftSection={<IconTransform size={14} />}
                        onClick={onConvertToGroupChat}
                      >
                        단체 채팅방으로 변환
                      </Menu.Item>
                    )}

                    {/* Lorebook Settings Item - Conditionally render (Only in non-share view) */}
                    {!isShareView && onOpenLorebookSettings && (
                      <Menu.Item
                        leftSection={<IconBook size={14} />}
                        onClick={onOpenLorebookSettings}
                      >
                        로어북 설정
                      </Menu.Item>
                    )}

                    {/* Export Chat Item - Conditionally render if onExport exists */}
                    {onExport && (
                      <Menu.Item
                        leftSection={<IconDownload size={14} />}
                        onClick={onExport}
                      >
                        채팅 내용 내보내기
                      </Menu.Item>
                    )}


                    {/* Delete Chat Room Item - Always visible */}
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={14} />}
                      onClick={() => setIsDeleteConfirmModalOpen(true)}
                    >
                      채팅방 삭제
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          )}
        </>
      )}
      {/* Hidden File Input */}
      {!isShareView && chatRoom?.isGroupChat && (
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={handleFileSelected}
        />
      )}
    </div>
  );
};

export default ChatHeader;