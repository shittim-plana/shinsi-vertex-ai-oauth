'use client';

import { useState, useEffect } from 'react';
import { Card, Stack, Group, Text, Badge, Button, Loader, Alert, Tooltip, ActionIcon } from '@mantine/core';
import { IconGitBranch, IconExternalLink, IconCalendar, IconMessageCircle, IconAlertCircle } from '@tabler/icons-react';
import { ChatRoom } from '../../types/chat';
import { useRouter } from 'next/navigation';

interface ForksListProps {
  parentRoomId?: string; // 부모 채팅방 ID (현재 채팅방에서 생성된 분기들 표시)
  currentRoomId?: string; // 현재 채팅방 ID (형제 분기들 표시)
  compact?: boolean; // 컴팩트 모드
  maxItems?: number; // 최대 표시 개수
}

interface ForkInfo extends ChatRoom {
  messageCount?: number; // 메시지 개수 (선택적)
}

export default function ForksList({ 
  parentRoomId, 
  currentRoomId, 
  compact = false, 
  maxItems = 5 
}: ForksListProps) {
  const [forks, setForks] = useState<ForkInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // 분기 목록 가져오기
  useEffect(() => {
    const fetchForks = async () => {
      if (!parentRoomId && !currentRoomId) return;

      setLoading(true);
      setError(null);

      try {
        const targetRoomId = parentRoomId || currentRoomId;
        const response = await fetch(`/api/chat/forks?roomId=${targetRoomId}&type=${parentRoomId ? 'children' : 'siblings'}`);
        
        if (!response.ok) {
          throw new Error('분기 목록을 불러오는데 실패했습니다.');
        }

        const data = await response.json();
        setForks(data.forks || []);
      } catch (err) {
        console.error('분기 목록 조회 오류:', err);
        setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };

    fetchForks();
  }, [parentRoomId, currentRoomId]);

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
      return date.toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (error) {
      return '알 수 없음';
    }
  };

  const handleForkClick = (forkId: string) => {
    router.push(`/chat/${forkId}`);
  };

  if (loading) {
    return (
      <Card withBorder p="md">
        <Group justify="center">
          <Loader size="sm" />
          <Text size="sm" c="dimmed">분기 목록 로딩 중...</Text>
        </Group>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        {error}
      </Alert>
    );
  }

  if (forks.length === 0) {
    return (
      <Card withBorder p="md">
        <Group justify="center">
          <IconGitBranch size={20} color="var(--mantine-color-gray-5)" />
          <Text size="sm" c="dimmed">
            {parentRoomId ? '생성된 분기가 없습니다.' : '다른 분기가 없습니다.'}
          </Text>
        </Group>
      </Card>
    );
  }

  const displayForks = maxItems ? forks.slice(0, maxItems) : forks;
  const hasMore = maxItems && forks.length > maxItems;

  return (
    <Card withBorder p="md">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <IconGitBranch size={18} />
            <Text fw={600} size="sm">
              {parentRoomId ? '생성된 분기' : '관련 분기'} ({forks.length})
            </Text>
          </Group>
        </Group>

        <Stack gap="sm">
          {displayForks.map((fork) => (
            <Card
              key={fork.id}
              withBorder
              padding={compact ? "xs" : "sm"}
              style={{ cursor: 'pointer' }}
              onClick={() => handleForkClick(fork.id)}
            >
              <Group justify="space-between" align="flex-start">
                <Stack gap="xs" style={{ flex: 1 }}>
                  <Group gap="xs" align="center">
                    <Text 
                      size={compact ? "xs" : "sm"} 
                      fw={500}
                      lineClamp={1}
                      style={{ flex: 1 }}
                    >
                      {fork.name}
                    </Text>
                    
                    {fork.id === currentRoomId && (
                      <Badge size="xs" color="blue">현재</Badge>
                    )}
                  </Group>

                  {fork.forkPoint?.description && (
                    <Text 
                      size="xs" 
                      c="dimmed" 
                      fs="italic"
                      lineClamp={compact ? 1 : 2}
                    >
                      &quot;{fork.forkPoint.description}&quot;
                    </Text>
                  )}

                  <Group gap="md" align="center">
                    {fork.forkPoint?.timestamp && (
                      <Group gap={4} align="center">
                        <IconCalendar size={12} color="var(--mantine-color-gray-6)" />
                        <Text size="xs" c="dimmed">
                          {formatForkTime(fork.forkPoint.timestamp)}
                        </Text>
                      </Group>
                    )}

                    {fork.messageCount !== undefined && (
                      <Group gap={4} align="center">
                        <IconMessageCircle size={12} color="var(--mantine-color-gray-6)" />
                        <Text size="xs" c="dimmed">
                          {fork.messageCount}개
                        </Text>
                      </Group>
                    )}
                  </Group>
                </Stack>

                <Tooltip label="분기로 이동" position="left">
                  <ActionIcon 
                    variant="subtle" 
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleForkClick(fork.id);
                    }}
                  >
                    <IconExternalLink size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Card>
          ))}
        </Stack>

        {hasMore && (
          <Button 
            variant="subtle" 
            size="sm" 
            onClick={() => {
              // 전체 분기 목록 모달이나 페이지로 이동하는 로직
              console.log('더 많은 분기 보기');
            }}
          >
            {forks.length - maxItems}개 더 보기
          </Button>
        )}
      </Stack>
    </Card>
  );
}