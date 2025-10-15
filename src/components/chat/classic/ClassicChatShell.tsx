'use client';
import React from 'react';
import { Box } from '@mantine/core';
import styles from './classic.module.css';
import type { RoomUIConfig } from '@/types/chat';

interface ClassicChatShellProps {
  ui: RoomUIConfig;
  header?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  notifications?: React.ReactNode;
}

const ClassicChatShell: React.FC<ClassicChatShellProps> = ({
  ui,
  header,
  children,
  footer,
  notifications,
}) => {
  return (
    <Box className={styles.classicShellWrapper}>
      {/* Classic 모드: 배경은 기본적으로 단색/테마 색상 사용.
          필요 시 RoomUIConfig의 backgroundImage 등을 확장 적용 가능 */}
      <Box
        className={styles.shell}
        data-narrative-max={ui.narrativeMaxWidth ?? 920}
        data-image-width={ui.imageMessageWidth ?? 720}
        data-radius={ui.borderRadius ?? 10}
        data-accent-color={ui.accentColor ?? '#8ac8ff'}
      >
        {/* 헤더 - 스크롤 시 상단 고정 */}
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

        {/* 푸터 - Classic MessageInput 자체가 sticky를 가지므로 여기서는 일반 flow로 배치 */}
        {footer && (
          <Box className={styles.shellFooter}>
            {footer}
          </Box>
        )}
      </Box>

      {/* 알림 컨테이너 (선택) */}
      {notifications && (
        <Box className={styles.notificationsContainer}>
          {notifications}
        </Box>
      )}
    </Box>
  );
};

export default ClassicChatShell;