'use client';

import { Badge, Group, Text, Tooltip, ActionIcon } from '@mantine/core';
import { IconGitBranch, IconInfoCircle } from '@tabler/icons-react';
import { ChatRoom } from '../../types/chat';

interface ForkIndicatorProps {
  chatRoom: ChatRoom;
  compact?: boolean; // 컴팩트 모드 (헤더용)
}

export default function ForkIndicator({ chatRoom, compact = false }: ForkIndicatorProps) {
  if (!chatRoom.isFork || !chatRoom.forkPoint) {
    return null;
  }

  const formatForkTime = (timestamp: any) => {
    try {
      let date: Date;
      if (timestamp && typeof timestamp === 'object' && 'toDate' in timestamp) {
        date = timestamp.toDate();
      } else if (timestamp instanceof Date) {
        date = timestamp;
      } else {
        date = new Date(timestamp);
      }
      return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      console.error('분기 시간 포맷 오류:', error);
      return '알 수 없음';
    }
  };

  const tooltipContent = (
    <div style={{ maxWidth: 250 }}>
      <Text size="sm" fw={600} mb="xs">분기 정보</Text>
      <Text size="xs" mb="xs">
        <strong>분기 시점:</strong> {formatForkTime(chatRoom.forkPoint.timestamp)}
      </Text>
      {chatRoom.forkPoint.description && (
        <Text size="xs" mb="xs">
          <strong>분기 사유:</strong> {chatRoom.forkPoint.description}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        이 채팅방은 특정 지점에서 분기되어 생성되었습니다.
      </Text>
    </div>
  );

  if (compact) {
    return (
      <Tooltip label={tooltipContent} multiline withArrow position="bottom">
        <Badge
          variant="light"
          color="blue"
          size="sm"
          leftSection={<IconGitBranch size={12} />}
          style={{ cursor: 'help' }}
        >
          분기
        </Badge>
      </Tooltip>
    );
  }

  return (
    <Group gap="xs" align="center">
      <Badge
        variant="light"
        color="blue"
        size="md"
        leftSection={<IconGitBranch size={14} />}
      >
        분기된 채팅방
      </Badge>
      
      <Tooltip label={tooltipContent} multiline withArrow>
        <ActionIcon variant="subtle" size="sm" color="blue">
          <IconInfoCircle size={16} />
        </ActionIcon>
      </Tooltip>
      
      {chatRoom.forkPoint.description && (
        <Text size="sm" c="dimmed" fs="italic">
          &quot;{chatRoom.forkPoint.description}&quot;
        </Text>
      )}
    </Group>
  );
}