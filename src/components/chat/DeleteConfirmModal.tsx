import React from 'react';
import { Modal, Group, ThemeIcon, Text, Stack, Button } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title={
        <Group gap="xs">
          <ThemeIcon color="red" variant="light" size="lg" radius="xl"><IconAlertCircle size={20} /></ThemeIcon>
          <Text fw={500}>채팅방 삭제 확인</Text>
        </Group>
      }
      centered
      size="sm"
    >
      <Stack>
        <Text>정말로 이 채팅방을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>취소</Button>
          <Button color="red" onClick={onConfirm}>삭제</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default DeleteConfirmModal;