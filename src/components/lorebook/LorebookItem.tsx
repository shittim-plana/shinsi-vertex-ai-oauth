'use client';

import { Card, Text, Group, Stack, ActionIcon, Tooltip, Collapse, Badge, Box } from '@mantine/core'; // Button 제거, Box 추가
import { IconPencil, IconTrash, IconSparkles, IconChevronDown, IconChevronUp, IconLock, IconWorld } from '@tabler/icons-react'; // 아이콘 추가
import { LorebookEntry } from '@/types/lorebook';
import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

interface LorebookItemProps {
  entry: LorebookEntry; // tags, isPublic 포함됨
  currentUserId?: string; // 현재 사용자 ID (optional)
  canManage?: boolean; // 관리자/부관리자 여부 (optional)
  onEdit: (entry: LorebookEntry) => void;
  onDelete: (id: string) => void;
  onSummarize: (id: string, description: string) => void;
  isSummarizing: boolean; // 요약 진행 중 상태
}

export function LorebookItem({ entry, currentUserId, canManage, onEdit, onDelete, onSummarize, isSummarizing }: LorebookItemProps) {
  const [expanded, setExpanded] = useState(false);

  const handleSummarizeClick = () => {
    if (!isSummarizing) {
      onSummarize(entry.id, entry.description);
    }
  };

  // Timestamp를 Date 객체로 변환 후 포맷팅
  const updatedAtDate = entry.updatedAt?.toDate();
  const formattedDate = updatedAtDate
    ? formatDistanceToNow(updatedAtDate, { addSuffix: true, locale: ko })
    : '날짜 정보 없음';

  const isOwner = currentUserId === entry.userId; // 현재 사용자가 소유자인지 확인
  const isPrivileged = !!canManage; // 관리자/부관리자

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={500} size="lg">{entry.title}</Text>
          <Group gap="xs">
            {/* 소유자 또는 관리자/부관리자일 경우에만 수정/삭제 버튼 표시 */}
            {(isOwner || isPrivileged) && (
              <>
                <Tooltip label="수정">
                  <ActionIcon variant="light" color="blue" onClick={() => onEdit(entry)}>
                    <IconPencil size={18} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="삭제">
                  <ActionIcon variant="light" color="red" onClick={() => onDelete(entry.id)}>
                    <IconTrash size={18} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            <Tooltip label={entry.isPublic ? "공개됨" : "비공개됨"}>
              <ActionIcon variant="subtle" color={entry.isPublic ? "green" : "gray"} style={{ cursor: 'default' }}>
                {entry.isPublic ? <IconWorld size={18} /> : <IconLock size={18} />}
              </ActionIcon>
            </Tooltip>
            <Tooltip label={expanded ? "내용 접기" : "내용 펼치기"}>
              <ActionIcon variant="subtle" color="gray" onClick={() => setExpanded((o) => !o)}>
                {expanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>

        <Group justify="space-between" align="center">
            <Text size="xs" c="dimmed">
              마지막 수정: {formattedDate}
            </Text>
            {/* 공개/비공개 상태 뱃지 (아이콘으로 대체했으므로 주석 처리 또는 제거 가능) */}
            {/* <Badge
              size="sm"
              variant="light"
              color={entry.isPublic ? 'green' : 'gray'}
              leftSection={entry.isPublic ? <IconWorld size={12} /> : <IconLock size={12} />}
            >
              {entry.isPublic ? '공개' : '비공개'}
            </Badge> */}
        </Group>


        {/* 태그 표시 */}
        {entry.tags && entry.tags.length > 0 && (
          <Box mt="xs">
            <Group gap="xs">
              {entry.tags.map((tag) => (
                <Badge key={tag} variant="outline" size="sm">
                  {tag}
                </Badge>
              ))}
            </Group>
          </Box>
        )}

        {/* 요약 표시 */}
        {entry.summary && (
          <Badge color="yellow" variant="light" size="sm" mt="xs">
            요약: {entry.summary.length > 50 ? `${entry.summary.substring(0, 50)}...` : entry.summary}
          </Badge>
        )}

        <Collapse in={expanded}>
          <Text size="sm" mt="sm" style={{ whiteSpace: 'pre-wrap' }}>
            {entry.description}
          </Text>
        </Collapse>
      </Stack>
    </Card>
  );
}