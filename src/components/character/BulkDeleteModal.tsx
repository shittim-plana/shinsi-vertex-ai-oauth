'use client';

import { useState } from 'react';
import { 
  Modal, 
  Stack, 
  Text, 
  Button, 
  Group, 
  Alert, 
  List, 
  Badge,
  ScrollArea,
  TextInput,
  Textarea
} from '@mantine/core';
import { IconAlertCircle, IconTrash } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface BulkDeleteModalProps {
  opened: boolean;
  onClose: () => void;
  characters: Character[];
  onConfirm: (characters: Character[], reason?: string) => Promise<void>;
  loading?: boolean;
}

export function BulkDeleteModal({ 
  opened, 
  onClose, 
  characters, 
  onConfirm, 
  loading = false 
}: BulkDeleteModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  
  const isConfirmValid = confirmText === '삭제 확인';
  const characterCount = characters.length;

  const handleConfirm = async () => {
    if (!isConfirmValid) return;
    
    try {
      await onConfirm(characters, deletionReason || undefined);
      handleClose();
    } catch (error) {
      console.error('일괄 삭제 실패:', error);
    }
  };

  const handleClose = () => {
    setConfirmText('');
    setDeletionReason('');
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="sm">
          <IconTrash size={20} color="red" />
          <Text fw={600}>캐릭터 일괄 삭제</Text>
        </Group>
      }
      size="md"
      centered
    >
      <Stack gap="md">
        <Alert 
          icon={<IconAlertCircle size={16} />} 
          color="red" 
          variant="light"
        >
          <Text size="sm">
            선택한 {characterCount}개의 캐릭터가 삭제됩니다. 
            삭제된 캐릭터는 30일 후 영구적으로 제거되며, 그 전까지는 복구할 수 있습니다.
          </Text>
        </Alert>

        <div>
          <Text fw={500} mb="xs">삭제될 캐릭터 목록:</Text>
          <ScrollArea h={Math.min(200, characterCount * 40)} 
            style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: '4px' }}
          >
            <List spacing="xs" size="sm" p="sm">
              {characters.map((character) => (
                <List.Item key={character.id}>
                  <Group justify="space-between" wrap="nowrap">
                    <Text truncate="end" flex={1}>{character.name}</Text>
                    <Group gap="xs">
                      {!character.isPublic && (
                        <Badge color="gray" variant="light" size="xs">
                          비공개
                        </Badge>
                      )}
                      {character.isNSFW && (
                        <Badge color="red" variant="light" size="xs">
                          NSFW
                        </Badge>
                      )}
                    </Group>
                  </Group>
                </List.Item>
              ))}
            </List>
          </ScrollArea>
        </div>

        <Textarea
          label="삭제 사유 (선택사항)"
          placeholder="삭제하는 이유를 입력하세요..."
          value={deletionReason}
          onChange={(event) => setDeletionReason(event.currentTarget.value)}
          minRows={2}
          maxRows={4}
        />

        <div>
          <Text size="sm" mb="xs">
            계속하려면 <Text span fw={600} c="red">&quot;삭제 확인&quot;</Text>을 입력하세요:
          </Text>
          <TextInput
            placeholder="삭제 확인"
            value={confirmText}
            onChange={(event) => setConfirmText(event.currentTarget.value)}
            error={confirmText && !isConfirmValid ? '정확히 &quot;삭제 확인&quot;을 입력하세요' : undefined}
          />
        </div>

        <Group justify="flex-end" mt="md">
          <Button 
            variant="default" 
            onClick={handleClose}
            disabled={loading}
          >
            취소
          </Button>
          <Button 
            color="red" 
            onClick={handleConfirm}
            disabled={!isConfirmValid || loading}
            loading={loading}
            leftSection={<IconTrash size={16} />}
          >
            {characterCount}개 캐릭터 삭제
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}