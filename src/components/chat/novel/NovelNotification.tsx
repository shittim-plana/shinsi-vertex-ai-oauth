'use client';
import React from 'react';
import { Group, Text, Avatar, Box, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
import styles from './novel.module.css';

interface NovelNotificationProps {
  title?: string;
  message?: string;
  avatar?: string;
  senderName?: string;
  timestamp?: string;
  onClose?: () => void;
  autoClose?: boolean;
  duration?: number;
}

const NovelNotification: React.FC<NovelNotificationProps> = ({
  title = "Discord",
  message = "스크린샷이 클립보드에 복사됨\n스크린샷 폴더에 자동으로 저장됩니다.",
  avatar,
  senderName = "아리스 (부노카리멘, 체험 채널)",
  timestamp,
  onClose,
  autoClose = true,
  duration = 5000
}) => {
  React.useEffect(() => {
    if (autoClose && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, duration);
      
      return () => clearTimeout(timer);
    }
  }, [autoClose, onClose, duration]);

  return (
    <Box className={styles.novelNotification}>
      <Group align="flex-start" gap="sm" wrap="nowrap">
        {/* 앱 아이콘 */}
        <Avatar 
          src={avatar} 
          size={32} 
          radius="md"
          className={styles.notificationAvatar}
        />
        
        {/* 알림 내용 */}
        <Box className={styles.notificationContent}>
          <Group justify="space-between" align="flex-start" mb={4}>
            <Text size="sm" fw={600} className={styles.notificationAppName}>
              {title}
            </Text>
            {timestamp && (
              <Text size="xs" className={styles.notificationTime}>
                {timestamp}
              </Text>
            )}
          </Group>
          
          <Text size="sm" fw={500} className={styles.notificationSender} mb={2}>
            {senderName}
          </Text>
          
          <Text size="sm" lh={1.4} className={styles.notificationMessage}>
            {message}
          </Text>
        </Box>
        
        {/* 닫기 버튼 */}
        {onClose && (
          <ActionIcon
            onClick={onClose}
            className={styles.notificationClose}
            variant="subtle"
            size="sm"
            aria-label="알림 닫기"
          >
            <IconX size={14} />
          </ActionIcon>
        )}
      </Group>
    </Box>
  );
};

export default NovelNotification;