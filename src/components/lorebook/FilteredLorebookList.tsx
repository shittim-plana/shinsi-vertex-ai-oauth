'use client';

import { Stack, Text, Alert, Loader, Group } from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import { LorebookEntry } from '@/types/lorebook';
import { LorebookItem } from './LorebookItem';

interface FilteredLorebookListProps {
  entries: LorebookEntry[];
  loading: boolean;
  error: string | null;
  currentUserId?: string;
  canManage?: boolean;
  searchQuery: string;
  hasFilters: boolean;
  onEdit: (entry: LorebookEntry) => void;
  onDelete: (id: string) => void;
  onSummarize: (id: string, description: string) => void;
  summarizingId: string | null;
}

export function FilteredLorebookList({
  entries,
  loading,
  error,
  currentUserId,
  canManage,
  searchQuery,
  hasFilters,
  onEdit,
  onDelete,
  onSummarize,
  summarizingId
}: FilteredLorebookListProps) {
  if (loading) {
    return (
      <Group justify="center" mt="xl">
        <Loader />
      </Group>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size="1rem" />} title="데이터 로딩 오류" color="red" mb="lg">
        {error}
      </Alert>
    );
  }

  if (entries.length === 0) {
    if (hasFilters || searchQuery.trim()) {
      return (
        <Alert icon={<IconSearch size="1rem" />} title="검색 결과 없음" color="blue" mt="xl">
          <Text size="sm">
            현재 설정된 필터나 검색 조건에 맞는 로어북이 없습니다.
            {searchQuery.trim() && (
              <>
                <br />
                검색어: &quot;{searchQuery}&quot;
              </>
            )}
          </Text>
        </Alert>
      );
    }

    return (
      <Text c="dimmed" ta="center" mt="xl">
        아직 생성된 로어북 항목이 없습니다. &apos;새 로어북 추가&apos; 버튼을 눌러 시작해보세요.
      </Text>
    );
  }

  return (
    <Stack gap="md">
      {entries.map((entry) => (
        <LorebookItem
          key={entry.id}
          entry={entry}
          currentUserId={currentUserId}
          canManage={canManage}
          onEdit={onEdit}
          onDelete={onDelete}
          onSummarize={onSummarize}
          isSummarizing={summarizingId === entry.id}
        />
      ))}
    </Stack>
  );
}