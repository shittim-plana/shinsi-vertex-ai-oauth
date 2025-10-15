'use client';
import React from 'react';
import { Box } from '@mantine/core';
import styles from './novel.module.css';
import NovelBackgroundLayer from './NovelBackgroundLayer';
import type { RoomUIConfig } from '@/types/chat';

interface NovelChatShellProps {
  ui: RoomUIConfig;
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  notifications?: React.ReactNode;
}

const NovelChatShell: React.FC<NovelChatShellProps> = ({
  ui,
  header,
  children,
  footer,
  notifications
}) => {
  return (
    <Box className={styles.novelShellWrapper}>
      {/* 배경 레이어 */}
      <NovelBackgroundLayer
        imageUrl={ui.backgroundImage ?? null}
        overlayOpacity={ui.overlayOpacity ?? 0.6}
        blur={ui.blur ?? 8}
      />
      
      {/* 메인 셸 */}
      <Box
        className={styles.shell}
        data-narrative-max={ui.narrativeMaxWidth ?? 920}
        data-image-width={ui.imageMessageWidth ?? 720}
        data-radius={ui.borderRadius ?? 10}
        data-accent-color={ui.accentColor ?? '#8ac8ff'}
      >
        {/* 헤더 */}
        {header && (
          <Box className={styles.shellHeader}>
            {header}
          </Box>
        )}
        
        {/* 메인 콘텐츠 */}
        <Box className={styles.container}>
          <Box className={styles.shellContent}>
            {children}
          </Box>
        </Box>
        
        {/* 푸터 (메시지 입력창 등) */}
        {footer && (
          <Box className={styles.shellFooter}>
            {footer}
          </Box>
        )}
      </Box>
      
      {/* 알림창들 */}
      {notifications && (
        <Box className={styles.notificationsContainer}>
          {notifications}
        </Box>
      )}
    </Box>
  );
};

export default NovelChatShell;