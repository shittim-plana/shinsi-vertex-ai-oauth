'use client';

import { SegmentedControl, Box, Group, Select, ActionIcon } from '@mantine/core';
import { useState, useEffect } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { IconFilter } from '@tabler/icons-react';
import { db } from '@/firebase/config';
import { collection, getDocs } from 'firebase/firestore';

interface CategoryFilterProps {
  selectedCategory: string | null;
  onChange: (category: string | null) => void;
}

export function CategoryFilter({ selectedCategory, onChange }: CategoryFilterProps) {
  const [categories, setCategories] = useState<{ label: string; value: string }[]>([
    { label: '전체', value: 'all' },
  ]);
  
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [showFilter, setShowFilter] = useState(false);

  // Fetch categories from Firestore
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        // Use a fallback in case of errors
        let categoryData = [
          { label: '전체', value: 'all' },
          { label: '일반', value: 'general' },
          { label: '커뮤니티', value: 'community' },
          { label: '게임', value: 'games' }
        ];
        
        try {
          const categoriesRef = collection(db, 'categories');
          const querySnapshot = await getDocs(categoriesRef);
          
          if (!querySnapshot.empty) {
            const fetchedCategories = querySnapshot.docs.map(doc => ({
              label: doc.data().name || '카테고리',
              value: doc.id
            }));
            
            // Only override if we fetched valid categories
            if (fetchedCategories.length > 0) {
              // Add "All" as the first option
              fetchedCategories.unshift({ label: '전체', value: 'all' });
              categoryData = fetchedCategories;
            }
          }
        } catch (firebaseError) {
          console.error('Firestore 카테고리 로딩 에러:', firebaseError);
          // Fall back to default categories (already defined above)
        }
        
        setCategories(categoryData);
      } catch (error) {
        console.error('카테고리 로딩 에러:', error);
        // Ensure we always have at least a default "All" category
        setCategories([{ label: '전체', value: 'all' }]);
      }
    };
    
    fetchCategories();
  }, []);

  // Handle category change
  const handleChange = (value: string | null) => {
    if (value === null) {
      onChange(null);
    } else {
      onChange(value === 'all' ? null : value);
    }
  };

  // Toggle filter visibility on mobile
  const toggleFilter = () => {
    setShowFilter(!showFilter);
  };

  if (isMobile) {
    return (
      <Box>
        <Group justify="flex-end">
          <ActionIcon onClick={toggleFilter} variant="subtle">
            <IconFilter size={20} />
          </ActionIcon>
        </Group>
        
        {showFilter && (
          <Select
            data={categories}
            value={selectedCategory || 'all'}
            onChange={handleChange}
            placeholder="카테고리 선택"
            clearable={false}
            mt="xs"
          />
        )}
      </Box>
    );
  }

  return (
    <SegmentedControl
      data={categories.slice(0, 6)} // Limit to first 6 categories for desktop
      value={selectedCategory || 'all'}
      onChange={handleChange}
    />
  );
}

export default CategoryFilter;