'use client';

import { Group, SegmentedControl, Badge } from '@mantine/core';
import { IconWorld, IconLock, IconList } from '@tabler/icons-react';
import { LorebookFilter } from '@/types/lorebook';

interface LorebookFiltersProps {
  currentFilter: LorebookFilter;
  filterCounts: {
    all: number;
    public: number;
    private: number;
  };
  onFilterChange: (filter: LorebookFilter) => void;
}

export function LorebookFilters({ currentFilter, filterCounts, onFilterChange }: LorebookFiltersProps) {
  const filterData = [
    {
      label: (
        <Group gap="xs" justify="center">
          <IconList size={16} />
          <span>전체</span>
          <Badge size="sm" variant="light" color="blue">
            {filterCounts.all}
          </Badge>
        </Group>
      ),
      value: 'all' as const
    },
    {
      label: (
        <Group gap="xs" justify="center">
          <IconWorld size={16} />
          <span>공개</span>
          <Badge size="sm" variant="light" color="green">
            {filterCounts.public}
          </Badge>
        </Group>
      ),
      value: 'public' as const
    },
    {
      label: (
        <Group gap="xs" justify="center">
          <IconLock size={16} />
          <span>비공개</span>
          <Badge size="sm" variant="light" color="gray">
            {filterCounts.private}
          </Badge>
        </Group>
      ),
      value: 'private' as const
    }
  ];

  return (
    <SegmentedControl
      value={currentFilter}
      onChange={(value) => onFilterChange(value as LorebookFilter)}
      data={filterData}
      size="md"
      fullWidth
    />
  );
}