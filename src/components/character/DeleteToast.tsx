'use client';

import { useState, useEffect } from 'react';
import { Notification, Button, Group, Text, Progress } from '@mantine/core';
import { IconTrash, IconRestore } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface DeleteToastProps {
  character: Character;
  onUndo: () => void;
  onConfirm: () => void;
  duration?: number; // 초 단위
}

export function DeleteToast({ 
  character, 
  onUndo, 
  onConfirm, 
  duration = 5 
}: DeleteToastProps) {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setIsVisible(false);
          setTimeout(() => onConfirm(), 100); // 약간의 지연 후 확인
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [onConfirm]);

  const handleUndo = () => {
    setIsVisible(false);
    onUndo();
  };

  if (!isVisible) {
    return null;
  }

  const progressValue = ((duration - timeLeft) / duration) * 100;

  return (
    <Notification
      icon={<IconTrash size={20} />}
      color="red"
      title={`${character.name} 삭제됨`}
      withCloseButton={false}
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: 1000,
        minWidth: '350px',
        maxWidth: '400px'
      }}
    >
      <Text size="sm" mb="sm">
        캐릭터가 삭제되었습니다. {timeLeft}초 후 영구적으로 삭제됩니다.
      </Text>
      
      <Progress 
        value={progressValue} 
        size="xs" 
        mb="sm" 
        color="red"
        animated
      />
      
      <Group justify="flex-end" gap="xs">
        <Button
          variant="light"
          color="blue"
          size="xs"
          leftSection={<IconRestore size={14} />}
          onClick={handleUndo}
        >
          삭제 취소
        </Button>
      </Group>
    </Notification>
  );
}