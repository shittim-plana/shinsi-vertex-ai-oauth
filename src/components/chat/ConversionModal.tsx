import React, { useState } from 'react';
import { Modal, Button, Text, Stack, Group, Select, Textarea, Alert } from '@mantine/core';
import { IconInfoCircle, IconUsers, IconUser } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface ConversionModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: (characterId?: string, reason?: string) => void;
  fromType: 'group' | 'private';
  toType: 'group' | 'private';
  characters?: Character[];
  activeCharacterIds?: string[];
  isLoading?: boolean;
  auto?: boolean;
}

export default function ConversionModal({
  opened,
  onClose,
  onConfirm,
  fromType,
  toType,
  characters = [],
  activeCharacterIds = [],
  isLoading = false,
  auto = false
}: ConversionModalProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>('');
  const [reason, setReason] = useState('');

  const handleConfirm = () => {
    if (toType === 'private' && !selectedCharacterId) {
      return; // 캐릭터가 선택되지 않은 경우
    }
    onConfirm(selectedCharacterId || undefined, reason || undefined);
  };

  const handleClose = () => {
    setSelectedCharacterId('');
    setReason('');
    onClose();
  };

  // 활성 캐릭터 목록 생성 (private 전환 시 사용)
  const activeCharacters = characters.filter(char => 
    activeCharacterIds.includes(char.id)
  );

  const characterOptions = activeCharacters.map(char => ({
    value: char.id,
    label: char.name
  }));

  const getTitle = () => {
    if (auto) {
      return '자동 채팅방 전환';
    }
    return fromType === 'group' 
      ? '개인 채팅방으로 전환' 
      : '그룹 채팅방으로 전환';
  };

  const getDescription = () => {
    if (auto) {
      return '활성 캐릭터가 1명만 남아 자동으로 개인 채팅방으로 전환됩니다.';
    }
    
    if (fromType === 'group' && toType === 'private') {
      return '그룹 채팅방을 개인 채팅방으로 전환하시겠습니까? 선택한 캐릭터와의 1:1 채팅이 됩니다.';
    } else {
      return '개인 채팅방을 그룹 채팅방으로 전환하시겠습니까? 현재 캐릭터가 그룹에 포함됩니다.';
    }
  };

  const getIcon = () => {
    return toType === 'private' ? <IconUser size={20} /> : <IconUsers size={20} />;
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm">
          {getIcon()}
          <Text fw={600}>{getTitle()}</Text>
        </Group>
      }
      centered
      size="md"
    >
      <Stack gap="md">
        <Alert icon={<IconInfoCircle size={16} />} color="blue" variant="light">
          {getDescription()}
        </Alert>

        {toType === 'private' && activeCharacters.length > 1 && (
          <Select
            label="대화할 캐릭터 선택"
            placeholder="캐릭터를 선택해주세요"
            data={characterOptions}
            value={selectedCharacterId}
            onChange={(value) => setSelectedCharacterId(value || '')}
            required
          />
        )}

        {toType === 'private' && activeCharacters.length === 1 && (
          <Text size="sm" c="dimmed">
            <strong>{activeCharacters[0].name}</strong>와의 개인 채팅방으로 전환됩니다.
          </Text>
        )}

        {!auto && (
          <Textarea
            label="전환 사유 (선택사항)"
            placeholder="전환 사유를 입력해주세요..."
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.currentTarget.value)}
          />
        )}

        <Alert color="yellow" variant="light">
          <Text size="sm">
            <strong>주의:</strong> 채팅방 전환 후에도 기존 메시지와 설정은 유지됩니다.
          </Text>
        </Alert>

        <Group justify="flex-end" gap="sm">
          <Button 
            variant="light" 
            onClick={handleClose}
            disabled={isLoading}
          >
            취소
          </Button>
          <Button 
            onClick={handleConfirm}
            loading={isLoading}
            disabled={toType === 'private' && activeCharacters.length > 1 && !selectedCharacterId}
          >
            {auto ? '자동 전환 승인' : '전환하기'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}