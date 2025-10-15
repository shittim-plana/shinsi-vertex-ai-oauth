import React from 'react';
import { Modal, Stack, Textarea, Group, Button } from '@mantine/core';

interface EditMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  editText: string;
  setEditText: (text: string) => void;
  onSave: () => void;
}

const EditMessageModal: React.FC<EditMessageModalProps> = ({
  isOpen,
  onClose,
  editText,
  setEditText,
  onSave,
}) => {
  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="메시지 수정"
      centered
    >
      <Stack>
        <Textarea
          value={editText}
          onChange={(event) => setEditText(event.currentTarget.value)}
          minRows={3}
          autosize
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>취소</Button>
          <Button onClick={onSave}>저장</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default EditMessageModal;