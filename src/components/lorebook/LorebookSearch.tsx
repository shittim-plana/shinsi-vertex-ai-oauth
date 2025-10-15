'use client';

import { Group, TextInput, Select, ActionIcon, Tooltip } from '@mantine/core';
import { IconSearch, IconSortAscending, IconSortDescending, IconX } from '@tabler/icons-react';
import { LorebookFilters } from '@/types/lorebook';

interface LorebookSearchProps {
  searchQuery: string;
  sortBy: LorebookFilters['sortBy'];
  sortOrder: LorebookFilters['sortOrder'];
  onSearchChange: (query: string) => void;
  onSortChange: (sortBy: LorebookFilters['sortBy'], sortOrder?: LorebookFilters['sortOrder']) => void;
  onReset: () => void;
}

export function LorebookSearch({ 
  searchQuery, 
  sortBy, 
  sortOrder, 
  onSearchChange, 
  onSortChange,
  onReset 
}: LorebookSearchProps) {
  const sortOptions = [
    { value: 'updatedAt', label: '수정일순' },
    { value: 'createdAt', label: '생성일순' },
    { value: 'title', label: '제목순' }
  ];

  const toggleSortOrder = () => {
    onSortChange(sortBy, sortOrder === 'asc' ? 'desc' : 'asc');
  };

  const clearSearch = () => {
    onSearchChange('');
  };

  const hasActiveFilters = searchQuery.trim() !== '' || sortBy !== 'updatedAt' || sortOrder !== 'desc';

  return (
    <Group gap="md" align="flex-end">
      <TextInput
        placeholder="제목, 설명, 태그로 검색..."
        leftSection={<IconSearch size={16} />}
        rightSection={
          searchQuery && (
            <ActionIcon 
              variant="subtle" 
              color="gray" 
              onClick={clearSearch}
              size="sm"
            >
              <IconX size={14} />
            </ActionIcon>
          )
        }
        value={searchQuery}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        style={{ flex: 1 }}
      />
      
      <Select
        data={sortOptions}
        value={sortBy}
        onChange={(value) => onSortChange(value as LorebookFilters['sortBy'])}
        placeholder="정렬 기준"
        style={{ minWidth: 120 }}
      />

      <Tooltip label={sortOrder === 'asc' ? '오름차순' : '내림차순'}>
        <ActionIcon
          variant="light"
          color="blue"
          onClick={toggleSortOrder}
          size="lg"
        >
          {sortOrder === 'asc' ? <IconSortAscending size={20} /> : <IconSortDescending size={20} />}
        </ActionIcon>
      </Tooltip>

      {hasActiveFilters && (
        <Tooltip label="필터 초기화">
          <ActionIcon
            variant="light"
            color="red"
            onClick={onReset}
            size="lg"
          >
            <IconX size={20} />
          </ActionIcon>
        </Tooltip>
      )}
    </Group>
  );
}