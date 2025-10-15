'use client';

import { ActionIcon, Tooltip } from '@mantine/core';
import { IconGitBranch } from '@tabler/icons-react';
import { useState } from 'react';
import { Message } from '../../types/chat';
import ForkModal from './ForkModal';

interface ForkButtonProps {
  message: Message;
  onFork: (messageId: string, description?: string) => Promise<void>;
  isVisible: boolean;
  disabled?: boolean;
}

export default function ForkButton({
  message,
  onFork,
  isVisible,
  disabled = false
}: ForkButtonProps) {
  const [modalOpened, setModalOpened] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    
    if (disabled || isLoading) return;
    
    setModalOpened(true);
  };

  const handleConfirm = async (description?: string) => {
    setIsLoading(true);
    try {
      await onFork(message.id, description);
    } catch (error) {
      console.error('분기 생성 중 오류:', error);
      throw error; // 모달에서 에러 처리
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (isLoading) return;
    setModalOpened(false);
  };

  // 메시지 미리보기 텍스트 (최대 100자)
  const messagePreview = message.text && message.text.length > 100
    ? message.text.substring(0, 100) + '...'
    : message.text;

  if (!isVisible) return null;

  return (
    <>
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
          disabled={disabled}
          onClick={handleButtonClick}
          style={{
            opacity: isVisible ? 1 : 0,
            transition: 'opacity 0.2s ease',
            cursor: disabled ? 'not-allowed' : 'pointer'
          }}
        >
          <IconGitBranch size={16} />
        </ActionIcon>
      </Tooltip>

      <ForkModal
        opened={modalOpened}
        onClose={handleClose}
        onConfirm={handleConfirm}
        messagePreview={messagePreview}
        isLoading={isLoading}
      />
    </>
  );
}