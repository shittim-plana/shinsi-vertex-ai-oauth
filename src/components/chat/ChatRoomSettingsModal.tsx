'use client';

import { useState, useEffect } from 'react';
import { Modal, Switch, Button, Group, Stack, Text, Alert, Divider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSettings, IconCheck, IconX, IconInfoCircle } from '@tabler/icons-react';
import { ChatRoom } from '@/types/chat';

interface ChatRoomSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatRoom: ChatRoom | null;
  onSave: (settings: ChatRoomSettings) => Promise<void>;
}

interface ChatRoomSettings {
  autoConvertToPrivate: boolean;
}

export function ChatRoomSettingsModal({ 
  isOpen, 
  onClose, 
  chatRoom, 
  onSave 
}: ChatRoomSettingsModalProps) {
  const [autoConvertToPrivate, setAutoConvertToPrivate] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 모달이 열릴 때 기존 설정값 로드
  useEffect(() => {
    if (isOpen && chatRoom) {
      setAutoConvertToPrivate(chatRoom.autoConvertToPrivate || false);
    }
  }, [isOpen, chatRoom]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({
        autoConvertToPrivate
      });
      
      notifications.show({
        title: '설정 저장 완료',
        message: '채팅방 설정이 성공적으로 저장되었습니다.',
        color: 'green',
        icon: <IconCheck />,
      });
      
      onClose();
    } catch (error) {
      console.error('채팅방 설정 저장 중 오류:', error);
      notifications.show({
        title: '설정 저장 실패',
        message: '채팅방 설정을 저장하는 중 오류가 발생했습니다.',
        color: 'red',
        icon: <IconX />,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    // 닫을 때 초기값으로 리셋
    if (chatRoom) {
      setAutoConvertToPrivate(chatRoom.autoConvertToPrivate || false);
    }
    onClose();
  };

  const isGroupChat = chatRoom?.isGroupChat || false;

  return (
    <Modal
      opened={isOpen}
      onClose={handleClose}
      title={
        <Group gap="sm">
          <IconSettings size={20} />
          <Text fw={600}>채팅방 설정</Text>
        </Group>
      }
      centered
      size="md"
    >
      <Stack gap="md">
        {/* 자동 전환 설정 섹션 */}
        <Stack gap="sm">
          <Text fw={500} size="sm">자동 전환 설정</Text>
          
          <Switch
            checked={autoConvertToPrivate}
            onChange={(event) => setAutoConvertToPrivate(event.currentTarget.checked)}
            label="그룹 채팅에서 자동으로 개인 채팅으로 전환"
            description="활성 캐릭터가 1명만 남을 때 자동으로 개인 채팅방으로 전환합니다."
            disabled={!isGroupChat}
          />

          {!isGroupChat && (
            <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
              <Text size="sm">
                개인 채팅방에서는 자동 전환 설정을 사용할 수 없습니다.
              </Text>
            </Alert>
          )}

          {isGroupChat && autoConvertToPrivate && (
            <Alert icon={<IconInfoCircle size={16} />} color="yellow" variant="light">
              <Text size="sm">
                <strong>자동 전환 활성화:</strong> 그룹 채팅에서 캐릭터를 제거하여 1명만 남게 되면 
                자동으로 해당 캐릭터와의 개인 채팅방으로 전환됩니다. 확인 모달이 표시됩니다.
              </Text>
            </Alert>
          )}
        </Stack>

        <Divider />

        {/* 현재 채팅방 정보 */}
        <Stack gap="xs">
          <Text fw={500} size="sm">현재 채팅방 정보</Text>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">채팅방 타입:</Text>
            <Text size="sm">{isGroupChat ? '그룹 채팅' : '개인 채팅'}</Text>
          </Group>
          {isGroupChat && chatRoom?.activeCharacterIds && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">활성 캐릭터 수:</Text>
              <Text size="sm">{chatRoom.activeCharacterIds.length}명</Text>
            </Group>
          )}
          {chatRoom?.conversionHistory && chatRoom.conversionHistory.length > 0 && (
            <Group justify="space-between">
              <Text size="sm" c="dimmed">전환 이력:</Text>
              <Text size="sm">{chatRoom.conversionHistory.length}회</Text>
            </Group>
          )}
        </Stack>

        {/* 버튼 그룹 */}
        <Group justify="flex-end" mt="md">
          <Button 
            variant="light" 
            onClick={handleClose}
            disabled={isSaving}
          >
            취소
          </Button>
          <Button 
            onClick={handleSave} 
            loading={isSaving}
          >
            저장하기
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}