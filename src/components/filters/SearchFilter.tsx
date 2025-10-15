'use client';

import { TextInput, Box, Group, ActionIcon } from '@mantine/core';
import { useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { IconSearch, IconX } from '@tabler/icons-react';

interface SearchFilterProps {
  searchQuery: string;
  onChange: (query: string) => void;
  placeholder?: string;
}

export function SearchFilter({ searchQuery, onChange, placeholder = '캐릭터 검색...' }: SearchFilterProps) {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [showSearch, setShowSearch] = useState(!isMobile);

  // Toggle search visibility on mobile
  const toggleSearch = () => {
    setShowSearch(!showSearch);
  };

  // Clear search query
  const clearSearch = () => {
    onChange('');
  };

  if (isMobile && !showSearch) {
    return (
      <Box>
        <Group justify="flex-end">
          <ActionIcon onClick={toggleSearch} variant="subtle">
            <IconSearch size={20} />
          </ActionIcon>
        </Group>
      </Box>
    );
  }

  return (
    <Box w={isMobile ? '100%' : 300}>
      <TextInput
        placeholder={placeholder}
        value={searchQuery}
        onChange={(event) => onChange(event.currentTarget.value)}
        rightSection={
          searchQuery ? (
            <ActionIcon onClick={clearSearch} variant="subtle">
              <IconX size={16} />
            </ActionIcon>
          ) : (
            <IconSearch size={16} opacity={0.5} />
          )
        }
      />
    </Box>
  );
}

export default SearchFilter;