'use client';

import { Button, ActionIcon } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface QuickDeleteButtonProps {
  character: Character;
  onDelete: (character: Character) => void;
  variant?: 'button' | 'icon';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  disabled?: boolean;
}

export function QuickDeleteButton({ 
  character, 
  onDelete, 
  variant = 'button',
  size = 'sm',
  disabled = false 
}: QuickDeleteButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // 부모 요소의 클릭 이벤트 방지
    onDelete(character);
  };

  if (variant === 'icon') {
    return (
      <ActionIcon
        variant="light"
        color="red"
        size={size}
        onClick={handleClick}
        disabled={disabled}
        aria-label={`${character.name} 삭제`}
      >
        <IconTrash size={14} />
      </ActionIcon>
    );
  }

  return (
    <Button
      variant="light"
      color="red"
      size={size}
      leftSection={<IconTrash size={16} />}
      onClick={handleClick}
      disabled={disabled}
    >
      삭제
    </Button>
  );
}