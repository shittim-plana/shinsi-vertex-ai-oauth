import { useState, useEffect, useMemo } from 'react';
import { LorebookEntry, LorebookFilters, LorebookFilter } from '@/types/lorebook';
import { useAccessibleLorebooks } from './useAccessibleLorebooks';

/**
 * 로어북 필터링 및 검색 기능을 제공하는 hook
 * @param uid 현재 사용자 ID
 * @returns 필터링된 로어북과 필터 상태 관리 함수들
 */
export function useFilteredLorebooks(uid: string | null) {
  const { lorebookEntries, loading, error } = useAccessibleLorebooks(uid);
  
  // 필터 상태 (로컬 스토리지에서 초기값 로드)
  const [filters, setFilters] = useState<LorebookFilters>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('lorebook-filters');
      if (saved) {
        try {
          return JSON.parse(saved);
        } catch {
          // 파싱 오류 시 기본값 사용
        }
      }
    }
    return {
      filter: 'all',
      searchQuery: '',
      sortBy: 'updatedAt',
      sortOrder: 'desc'
    };
  });

  // 필터 상태를 로컬 스토리지에 저장
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('lorebook-filters', JSON.stringify(filters));
    }
  }, [filters]);

  // 필터링된 로어북 계산
  const filteredLorebooks = useMemo(() => {
    if (!lorebookEntries) return [];

    let filtered = [...lorebookEntries];

    // 공개/비공개 필터링
    if (filters.filter !== 'all') {
      if (filters.filter === 'public') {
        filtered = filtered.filter(entry => entry.isPublic);
      } else if (filters.filter === 'private') {
        filtered = filtered.filter(entry => entry.userId === uid && !entry.isPublic);
      }
    }

    // 검색어 필터링
    if (filters.searchQuery.trim()) {
      const query = filters.searchQuery.toLowerCase().trim();
      filtered = filtered.filter(entry => 
        entry.title.toLowerCase().includes(query) ||
        entry.description.toLowerCase().includes(query) ||
        (entry.summary && entry.summary.toLowerCase().includes(query)) ||
        (entry.tags && entry.tags.some(tag => tag.toLowerCase().includes(query)))
      );
    }

    // 정렬
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (filters.sortBy) {
        case 'title':
          comparison = a.title.localeCompare(b.title, 'ko');
          break;
        case 'createdAt':
          comparison = a.createdAt.toMillis() - b.createdAt.toMillis();
          break;
        case 'updatedAt':
        default:
          comparison = a.updatedAt.toMillis() - b.updatedAt.toMillis();
          break;
      }

      return filters.sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [lorebookEntries, filters, uid]);

  // 각 필터별 항목 수 계산
  const filterCounts = useMemo(() => {
    if (!lorebookEntries) return { all: 0, public: 0, private: 0 };

    const all = lorebookEntries.length;
    const publicCount = lorebookEntries.filter(entry => entry.isPublic).length;
    const privateCount = lorebookEntries.filter(entry => entry.userId === uid && !entry.isPublic).length;

    return {
      all,
      public: publicCount,
      private: privateCount
    };
  }, [lorebookEntries, uid]);

  // 필터 업데이트 함수들
  const updateFilter = (filter: LorebookFilter) => {
    setFilters(prev => ({ ...prev, filter }));
  };

  const updateSearchQuery = (searchQuery: string) => {
    setFilters(prev => ({ ...prev, searchQuery }));
  };

  const updateSort = (sortBy: LorebookFilters['sortBy'], sortOrder?: LorebookFilters['sortOrder']) => {
    setFilters(prev => ({ 
      ...prev, 
      sortBy,
      sortOrder: sortOrder || prev.sortOrder
    }));
  };

  const resetFilters = () => {
    setFilters({
      filter: 'all',
      searchQuery: '',
      sortBy: 'updatedAt',
      sortOrder: 'desc'
    });
  };

  return {
    lorebookEntries: filteredLorebooks,
    allEntries: lorebookEntries,
    loading,
    error,
    filters,
    filterCounts,
    updateFilter,
    updateSearchQuery,
    updateSort,
    resetFilters
  };
}