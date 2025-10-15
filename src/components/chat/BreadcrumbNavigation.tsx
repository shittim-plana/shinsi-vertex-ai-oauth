'use client';

import { useState, useEffect } from 'react';
import { Breadcrumbs, Anchor, Text, Group, Skeleton, Alert } from '@mantine/core';
import { IconChevronRight, IconHome, IconAlertCircle, IconGitBranch } from '@tabler/icons-react';
import { ChatRoom } from '../../types/chat';
import Link from 'next/link';

interface BreadcrumbItem {
  id: string;
  title: string;
  forkReason?: string;
  isRoot?: boolean;
  isCurrent?: boolean;
}

interface BreadcrumbNavigationProps {
  currentRoom: ChatRoom;
  className?: string;
}

export default function BreadcrumbNavigation({ currentRoom, className }: BreadcrumbNavigationProps) {
  const [breadcrumbItems, setBreadcrumbItems] = useState<BreadcrumbItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const buildBreadcrumbChain = async () => {
      try {
        setLoading(true);
        setError(null);

        const items: BreadcrumbItem[] = [];
        let currentRoomData = currentRoom;

        // 현재 채팅방을 체인에 추가
        items.unshift({
          id: currentRoomData.id,
          title: currentRoomData.name || '제목 없음',
          forkReason: currentRoomData.forkPoint?.description,
          isCurrent: true,
          isRoot: !currentRoomData.parentRoomId
        });

        // 부모 채팅방들을 재귀적으로 추가
        while (currentRoomData.parentRoomId) {
          try {
            const response = await fetch(`/api/chat/room/${currentRoomData.parentRoomId}`);
            if (!response.ok) {
              console.warn(`부모 채팅방 조회 실패 (ID: ${currentRoomData.parentRoomId})`);
              break;
            }

            const { room: parentRoom } = await response.json();
            
            items.unshift({
              id: parentRoom.id,
              title: parentRoom.name || '제목 없음',
              forkReason: parentRoom.forkPoint?.description,
              isRoot: !parentRoom.parentRoomId
            });

            currentRoomData = parentRoom;

            // 무한 루프 방지 (최대 10단계)
            if (items.length >= 10) {
              console.warn('분기 체인이 너무 깊습니다. 최대 10단계까지만 표시합니다.');
              break;
            }
          } catch (fetchError) {
            console.error('부모 채팅방 정보 조회 중 오류:', fetchError);
            break;
          }
        }

        setBreadcrumbItems(items);
      } catch (err) {
        console.error('브레드크럼 체인 생성 중 오류:', err);
        setError('분기 네비게이션을 불러올 수 없습니다.');
      } finally {
        setLoading(false);
      }
    };

    if (currentRoom) {
      buildBreadcrumbChain();
    }
  }, [currentRoom]);

  if (loading) {
    return (
      <div className={className}>
        <Group gap="xs" align="center">
          <Skeleton height={20} width={100} />
          <IconChevronRight size={14} />
          <Skeleton height={20} width={80} />
        </Group>
      </div>
    );
  }

  if (error) {
    return (
      <Alert 
        icon={<IconAlertCircle size={16} />}
        color="yellow"
        variant="light"
        className={className}
      >
        {error}
      </Alert>
    );
  }

  // 루트 채팅방만 있는 경우 브레드크럼 숨김
  if (breadcrumbItems.length <= 1 && breadcrumbItems[0]?.isRoot) {
    return null;
  }

  const breadcrumbElements = breadcrumbItems.map((item, index) => {
    const isLast = index === breadcrumbItems.length - 1;
    
    if (item.isCurrent || isLast) {
      return (
        <Group key={item.id} gap={4} align="center">
          {item.isRoot ? (
            <IconHome size={14} />
          ) : (
            <IconGitBranch size={14} />
          )}
          <Text size="sm" fw={500} truncate style={{ maxWidth: 150 }}>
            {item.title}
          </Text>
          {item.forkReason && (
            <Text size="xs" c="dimmed" truncate style={{ maxWidth: 100 }}>
              ({item.forkReason})
            </Text>
          )}
        </Group>
      );
    }

    return (
      <Group key={item.id} gap={4} align="center">
        {item.isRoot ? (
          <IconHome size={14} />
        ) : (
          <IconGitBranch size={14} />
        )}
        <Anchor 
          component={Link}
          href={`/chat/${item.id}`}
          size="sm"
          truncate
          style={{ maxWidth: 150 }}
        >
          {item.title}
        </Anchor>
        {item.forkReason && (
          <Text size="xs" c="dimmed" truncate style={{ maxWidth: 100 }}>
            ({item.forkReason})
          </Text>
        )}
      </Group>
    );
  });

  return (
    <div className={className}>
      <Breadcrumbs 
        separator={<IconChevronRight size={14} />}
        separatorMargin="xs"
      >
        {breadcrumbElements}
      </Breadcrumbs>
    </div>
  );
}