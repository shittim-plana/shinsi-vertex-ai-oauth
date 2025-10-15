'use client';

import { useState, useEffect, useMemo, useCallback, useRef, Suspense } from 'react'; // Added useRef, Suspense
import { Container, Title, Tabs, Group, Text, Center, Loader } from '@mantine/core'; // Added Center, Loader
import { db } from '@/firebase/config';
import { collection, query, orderBy, getDocs, where, QueryConstraint, onSnapshot } from 'firebase/firestore'; // Added Query, QueryConstraint, onSnapshot
// Removed localStorage import
import { useAuth } from '@/contexts/AuthContext'; // user 객체는 유지 (필요 시)
import { IconFlame, IconMessages, IconSortAscendingLetters, IconClock } from '@tabler/icons-react';
import { CategoryFilter } from '@/components/filters/CategoryFilter';
import { SearchFilter } from '@/components/filters/SearchFilter';
import { AppShell } from '@/components/layout/AppShell';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Character } from '../../types/character'; // Use relative path
import { CharacterList } from '../../components/character/CharacterList'; // Use relative path
import { characterFromDoc } from '@/utils/firestoreUtils'; // Import the utility function
import { filterActiveCharacters } from '@/utils/character-utils';

// Constants for pagination
const CHARACTERS_PER_PAGE = 12;
const ALL_CHARACTERS_CACHE_KEY = 'allCharactersData'; // Cache key constant

function HomePage() {
  const [allCharacters, setAllCharacters] = useState<Character[]>([]); // State for all fetched characters (cache source)
  const [characters, setCharacters] = useState<Character[]>([]); // State for currently displayed characters (paginated/filtered)
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingCharacters, setLoadingCharacters] = useState(true);
  const [loadingMoreCharacters, setLoadingMoreCharacters] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>("popular"); // Default to 'popular'
  const [hasMoreCharacters, setHasMoreCharacters] = useState(true);
  // lastDoc is no longer needed for pagination when using cached data
  // const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const currentPageRef = useRef(1); // Ref to track current page for client-side pagination
  const { user, logOut, uid, loading: authLoading } = useAuth(); // Assuming useAuth provides a loading state
  const [isClient, setIsClient] = useState(false); // State to track client-side mount
  const router = useRouter();
  const searchParams = useSearchParams();
  // observerTarget ref is now managed within CharacterList

  // Track client-side mount
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Redirect logic remains, but might need adjustment based on authLoading
  useEffect(() => {
    // Only redirect if auth is resolved and user is not logged in on the client
    if (isClient && !authLoading && !uid) {
      router.push('/login');
    }
  }, [isClient, authLoading, uid, router]);

  // Terms agreement check removed

  // Memoize characters collection reference
  const charactersRef = useMemo(() => collection(db, 'characters'), []);

  // Sorting criteria is now determined directly within buildBaseQuery based on activeTab
  // Memoized sorting constraints to ensure stable references
  const sortConstraints = useMemo(() => ({
    popular: [orderBy('likesCount', 'desc'), orderBy('conversationCount', 'desc')],
    conversation: [orderBy('conversationCount', 'desc'), orderBy('likesCount', 'desc')],
    latest: [orderBy('createdAt', 'desc')],
    name: [orderBy('name', 'asc')],
  }), []);

  // Helper function to get sorting constraints based on active tab
  const getSortConstraints = useCallback((): QueryConstraint[] => {
    return sortConstraints[activeTab as keyof typeof sortConstraints] || sortConstraints.popular;
  }, [activeTab, sortConstraints]);

  // Helper function to build a query with common filters (category, sorting)
  // const buildQueryWithFilters = useCallback((baseConstraints: QueryConstraint[]): Query<DocumentData> => {
  //   const constraints = [...baseConstraints];

  //   // Category Filter
  //   if (selectedCategory) {
  //     constraints.push(where('category', '==', selectedCategory));
  //   }

  //   // Sorting
  //   constraints.push(...getSortConstraints());

  //   // NSFW Filter (Example - apply based on user settings or global filter)
  //   // if (!showNSFW) { constraints.push(where('isNSFW', '==', false)); }

  //   return query(charactersRef, ...constraints);
  // }, [charactersRef, selectedCategory, getSortConstraints]);
  // Function to fetch characters (initial load or tab/filter change)
  // Now fetches ALL characters and caches them with real-time updates
  const fetchCharacters = useCallback(async (forceRefresh = false) => {
    setLoadingCharacters(true);
    currentPageRef.current = 1; // Reset page number

    // 1. Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      // Removed localStorage cache check
    }

    console.log("Fetching characters from Firestore...");
    // 2. Fetch from Firestore if no valid cache or forceRefresh
    try {
      let fetchedAllCharacters: Character[] = [];

      // a. Fetch user's private characters (if logged in) - No pagination needed here usually
      const uidFromCookie = uid;
      if (uidFromCookie) {
        const privateConstraints: QueryConstraint[] = [
          where('creatorId', '==', uidFromCookie), // 쿠키 uid 사용
          where('isPublic', '==', false),
          where('isDeleted', '==', false),
          ...getSortConstraints() // Apply sorting to private chars as well
        ];
        console.log(`[DEBUG] 비공개 캐릭터 쿼리 생성: 정렬 제약=${JSON.stringify(getSortConstraints())}`);
        // No category filter for private characters? Or apply if needed.
        const privateQuery = query(charactersRef, ...privateConstraints);
        const privateSnapshot = await getDocs(privateQuery);
        const privateCharacters = privateSnapshot.docs
          .map(doc => characterFromDoc(doc))
          .filter((char): char is Character => char !== null);
        console.log(`[DEBUG] 비공개 캐릭터 가져오기 완료: ${privateCharacters.length}개`);
        fetchedAllCharacters = privateCharacters;
      }

      // b. Fetch ALL public characters - Apply category and sorting, NO pagination limit
      const publicConstraints: QueryConstraint[] = [where('isPublic', '==', true), where('isDeleted', '==', false)];
      if (selectedCategory) {
          publicConstraints.push(where('category', '==', selectedCategory));
      }
      publicConstraints.push(...getSortConstraints());
      console.log(`[DEBUG] 공개 캐릭터 쿼리 생성: 카테고리=${selectedCategory}, 정렬 제약=${JSON.stringify(getSortConstraints())}`);

      const publicQuery = query(charactersRef, ...publicConstraints);
      const publicSnapshot = await getDocs(publicQuery);
      const publicCharacters = publicSnapshot.docs
        .map(doc => characterFromDoc(doc))
        .filter((char): char is Character => char !== null);
      console.log(`[DEBUG] 공개 캐릭터 가져오기 완료: ${publicCharacters.length}개`);

      // Combine and store (defensive filter to exclude deleted)
      fetchedAllCharacters = filterActiveCharacters<Character>([...fetchedAllCharacters, ...publicCharacters]);
      console.log(`[DEBUG] 캐릭터 결합 및 필터링 완료: 총 ${fetchedAllCharacters.length}개`);

      // 최신순 탭에서는 클라이언트 사이드 정렬을 다시 적용하여 정확성 보장
      if (activeTab === 'latest') {
        console.log(`[DEBUG] 최신순 탭: 클라이언트 사이드 정렬 재적용`);
        fetchedAllCharacters = sortCharacters(fetchedAllCharacters, activeTab);
      }

      setAllCharacters(fetchedAllCharacters);

      // Removed localStorage cache saving

      // Set initial displayed characters (first page)
      setCharacters(fetchedAllCharacters.slice(0, CHARACTERS_PER_PAGE));
      setHasMoreCharacters(fetchedAllCharacters.length > CHARACTERS_PER_PAGE);
      console.log(`[DEBUG] 초기 표시 캐릭터 설정: ${Math.min(fetchedAllCharacters.length, CHARACTERS_PER_PAGE)}개 표시`);

    } catch (error) {
      console.error('캐릭터 로딩 에러:', error);
      setHasMoreCharacters(false); // Stop pagination on error
      setAllCharacters([]); // Clear data on error
      setCharacters([]);
    } finally {
      setLoadingCharacters(false);
    }
  }, [charactersRef, selectedCategory, activeTab, uid]); // Optimized dependencies

  // Real-time listener for public characters
  useEffect(() => {
    if (!uid) return;

    // Remove category filter from listener to minimize delay - filter on client side
    const publicConstraints: QueryConstraint[] = [
      where('isPublic', '==', true),
      where('isDeleted', '==', false),
      ...getSortConstraints() // Apply sorting based on activeTab
    ];

    const publicQuery = query(charactersRef, ...publicConstraints);
    const unsubscribePublic = onSnapshot(publicQuery, (snapshot) => {
      console.log(`[DEBUG] 공개 캐릭터 실시간 업데이트: ${snapshot.docs.length}개 문서`);
      const publicCharacters = snapshot.docs
        .map(doc => characterFromDoc(doc))
        .filter((char): char is Character => char !== null);

      console.log(`[DEBUG] 공개 캐릭터 변환 완료: ${publicCharacters.length}개 캐릭터`);

      // Update allCharacters with real-time data immediately
      setAllCharacters(prev => {
        const privateChars = prev.filter(char => !char.isPublic);
        const combined = [...privateChars, ...publicCharacters];
        const updated = filterActiveCharacters<Character>(combined);

        console.log(`[DEBUG] 공개 캐릭터 결합 완료: 총 ${updated.length}개 캐릭터`);

        // Apply current tab's sorting to maintain order
        const sorted = sortCharacters(updated, activeTab);
        console.log(`[DEBUG] 공개 캐릭터 정렬 완료: 탭=${activeTab}`);
        return sorted;
      });
    });

    return () => unsubscribePublic();
  }, [charactersRef, uid, activeTab]); // Optimized dependencies

  // Real-time listener for private characters
  useEffect(() => {
    if (!uid) return;

    const privateConstraints: QueryConstraint[] = [
      where('creatorId', '==', uid),
      where('isPublic', '==', false),
      where('isDeleted', '==', false),
      ...getSortConstraints() // Apply sorting based on activeTab
    ];

    const privateQuery = query(charactersRef, ...privateConstraints);
    const unsubscribePrivate = onSnapshot(privateQuery, (snapshot) => {
      console.log(`[DEBUG] 비공개 캐릭터 실시간 업데이트: ${snapshot.docs.length}개 문서`);
      const privateCharacters = snapshot.docs
        .map(doc => characterFromDoc(doc))
        .filter((char): char is Character => char !== null);

      console.log(`[DEBUG] 비공개 캐릭터 변환 완료: ${privateCharacters.length}개 캐릭터`);

      // Update allCharacters with real-time data immediately
      setAllCharacters(prev => {
        const publicChars = prev.filter(char => char.isPublic);
        const combined = [...privateCharacters, ...publicChars];
        const updated = filterActiveCharacters<Character>(combined);

        console.log(`[DEBUG] 비공개 캐릭터 결합 완료: 총 ${updated.length}개 캐릭터`);

        // Apply current tab's sorting to maintain order
        const sorted = sortCharacters(updated, activeTab);
        console.log(`[DEBUG] 비공개 캐릭터 정렬 완료: 탭=${activeTab}`);
        return sorted;
      });
    });

    return () => unsubscribePrivate();
  }, [charactersRef, uid, activeTab]); // Optimized dependencies

  // Helper function for client-side sorting based on activeTab
  // Optimized to preserve server-side sorting for latest tab
  const sortCharacters = useCallback((chars: Character[], currentActiveTab: string | null): Character[] => {
      console.log(`[DEBUG] sortCharacters 시작: 탭=${currentActiveTab}, 캐릭터 수=${chars.length}`);

      // For latest tab, server already sorts by createdAt desc, so minimal client sorting
      if (currentActiveTab === 'latest') {
          console.log('[DEBUG] 최신순 정렬 적용: createdAt 기준 내림차순');
          const sorted = [...chars].sort((a, b) => {
              const aTime = a.createdAt.getTime();
              const bTime = b.createdAt.getTime();
              console.log(`[DEBUG] 비교: ${a.name}(${aTime}) vs ${b.name}(${bTime})`);
              return bTime - aTime;
          });
          console.log(`[DEBUG] 최신순 정렬 완료: 첫 번째 캐릭터=${sorted[0]?.name}, 마지막 캐릭터=${sorted[sorted.length-1]?.name}`);
          return sorted;
      }

      const sortedChars = [...chars];

      const sortFunctions: { [key: string]: (a: Character, b: Character) => number } = {
          popular: (a, b) => (b.likesCount - a.likesCount) || (b.conversationCount - a.conversationCount),
          conversation: (a, b) => (b.conversationCount - a.conversationCount) || (b.likesCount - a.likesCount),
          name: (a, b) => a.name.localeCompare(b.name),
      };

      const sortFn = sortFunctions[currentActiveTab ?? 'popular'] || sortFunctions.popular;
      sortedChars.sort(sortFn);

      console.log(`[DEBUG] ${currentActiveTab} 정렬 완료: 캐릭터 수=${sortedChars.length}`);
      return sortedChars;
  }, []);


  // Helper function for client-side category filtering
  const filterCharactersByCategory = (chars: Character[], category: string | null): Character[] => {
      if (!category) return chars;
      // Ensure category comparison handles potential undefined values if needed
      return chars.filter(char => char.category === category);
  };


  // Fetch initial characters on mount (cookie check)
  useEffect(() => {
    const uidFromCookie = uid;
    if (uidFromCookie) { // Only fetch if user is authenticated
        // 최신순 탭에서는 캐시를 무시하여 실시간 데이터를 가져옴
        const shouldForceRefresh = activeTab === 'latest';
        console.log(`[DEBUG] 초기 캐릭터 로드: 탭=${activeTab}, 강제 새로고침=${shouldForceRefresh}`);
        fetchCharacters(shouldForceRefresh);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // user 의존성 제거

  // Re-fetch when tab or category changes (force refresh from Firestore for simplicity now)
  // Also, apply filtering/sorting to the currently displayed characters immediately if data is already cached
  useEffect(() => {
      const uidFromCookie = uid;
      if (uidFromCookie) { // Avoid fetching if user logs out during tab/category change
          // 최신순 탭에서는 캐시를 무시하여 실시간 데이터를 가져옴
          const shouldForceRefresh = activeTab === 'latest';
          console.log(`[DEBUG] 탭/카테고리 변경: 탭=${activeTab}, 카테고리=${selectedCategory}, 강제 새로고침=${shouldForceRefresh}`);
          // If we have cached data and not forcing refresh, apply filters/sort immediately without full fetch
          if (allCharacters.length > 0 && !shouldForceRefresh) {
              console.log(`[DEBUG] 캐시된 데이터에 필터/정렬 적용: 캐릭터 수=${allCharacters.length}`);
              currentPageRef.current = 1; // Reset page
              const sortedAll = sortCharacters(allCharacters, activeTab); // Pass activeTab for sorting
              const filteredAll = filterCharactersByCategory(sortedAll, selectedCategory);
              console.log(`[DEBUG] 필터링 완료: 필터링된 캐릭터 수=${filteredAll.length}`);
              setCharacters(filteredAll.slice(0, CHARACTERS_PER_PAGE));
              setHasMoreCharacters(filteredAll.length > CHARACTERS_PER_PAGE);
          } else {
              // If no cache or forcing refresh, fetch from Firestore
              console.log(`[DEBUG] Firestore에서 데이터 가져오기: 캐시 없음 또는 강제 새로고침`);
              fetchCharacters(shouldForceRefresh);
          }
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCategory]); // Re-run when these change

  // Handle refresh query parameter for character creation
  useEffect(() => {
    const refresh = searchParams.get('refresh');
    if (refresh === 'true' && uid) {
      console.log('Refreshing characters after creation');
      // 최신순 탭에서는 항상 캐시를 무시하여 실시간 데이터를 가져옴
      const shouldForceRefresh = activeTab === 'latest' || true; // 캐릭터 생성 후에는 항상 새로고침
      fetchCharacters(shouldForceRefresh);
      // Clean up the URL
      router.replace('/home', { scroll: false });
    }
  }, [searchParams, uid, fetchCharacters, router, activeTab]);


  // Function to load more characters (infinite scroll - loads from cached 'allCharacters') - Make async
  const loadMoreCharacters = useCallback(async () => { // Added async
    if (loadingMoreCharacters || !hasMoreCharacters || searchQuery.trim()) {
        // Do not load more if already loading, no more items, or if searching
        return;
    }

    setLoadingMoreCharacters(true);

    const nextPage = currentPageRef.current + 1;
    const startIndex = (nextPage - 1) * CHARACTERS_PER_PAGE;
    const endIndex = startIndex + CHARACTERS_PER_PAGE;

    // Apply current sort/filter to the full cached list before slicing
    // Use activeTab for sorting
    const sortedAll = sortCharacters(allCharacters, activeTab); // Use activeTab for sorting
    const filteredAll = filterCharactersByCategory(sortedAll, selectedCategory);

    const newCharacterData = filteredAll.slice(startIndex, endIndex);

    if (newCharacterData.length > 0) {
        setCharacters(prev => [...prev, ...newCharacterData]);
        currentPageRef.current = nextPage;
    }

    // Check if there are more characters beyond the newly loaded ones
    setHasMoreCharacters(filteredAll.length > endIndex);
    setLoadingMoreCharacters(false);

  }, [loadingMoreCharacters, hasMoreCharacters, allCharacters, selectedCategory, activeTab, searchQuery]); // Updated dependencies


  // Intersection Observer logic is now moved to CharacterList component
  // useEffect(() => { ... observer logic removed ... }, [dependencies]);


  // Client-side filtering based on search query
  // Client-side filtering based on search query - operates on ALL characters
  const searchFilteredCharacters = useMemo<Character[]>(() => {
    // Apply category and sort first (based on current filters/activeTab) to the full list
    const sortedAll = sortCharacters(allCharacters, activeTab);
    const filteredByCategory = filterCharactersByCategory(sortedAll, selectedCategory);

    if (!searchQuery.trim()) {
      // If no search query, return the full list filtered by category/sorted
      // Pagination will be handled by the display logic
      return filterActiveCharacters<Character>(filteredByCategory);
    }

    // If searching, filter the category-filtered/sorted list further by search query
    const queryLower = searchQuery.toLowerCase().trim();
    const filtered = filteredByCategory.filter(character =>
      character.name.toLowerCase().includes(queryLower) ||
      character.description.toLowerCase().includes(queryLower) ||
      character.tags.some(tag => tag.toLowerCase().includes(queryLower))
    );
    return filterActiveCharacters<Character>(filtered);
  }, [allCharacters, searchQuery, selectedCategory, activeTab]); // Updated dependencies

  // Determine characters to display based on search state and pagination
  const charactersToDisplay: Character[] = useMemo(() => {
      if (searchQuery.trim()) {
          // If searching, display all search-filtered results (no pagination)
          return searchFilteredCharacters;
      } else {
          // If not searching, display the paginated characters from the current 'characters' state
          // The 'characters' state is updated by fetchCharacters, loadMoreCharacters, and the tab/category useEffect
          return characters;
      }
  }, [searchQuery, searchFilteredCharacters, characters]);

  // Determine if pagination should be active
  const isPaginationActive = useMemo(() => {
      // Pagination is active only if not searching and there are more items
      // based on the *currently applied filters* (category/sort based on activeTab) on the full list
      const sortedAll = sortCharacters(allCharacters, activeTab); // Use activeTab for sorting
      const filteredByCategory = filterCharactersByCategory(sortedAll, selectedCategory);
      const totalFilteredCount = filteredByCategory.length;
      const currentlyDisplayedCount = characters.length; // Length of the paginated list

      return !searchQuery.trim() && currentlyDisplayedCount < totalFilteredCount;
  }, [searchQuery, allCharacters, characters, selectedCategory, activeTab]); // Updated dependencies

  // Update hasMoreCharacters state based on pagination activity
  useEffect(() => {
      setHasMoreCharacters(isPaginationActive);
  }, [isPaginationActive]);

  // Handle search query change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    // Note: Client-side search doesn't require re-fetching
  };

  // Handle category filter change
  const handleCategoryChange = (category: string | null) => {
    // Clear search when category changes? Optional.
    // setSearchQuery('');
    setSelectedCategory(category);
    // Filtering/sorting/fetching is handled by the useEffect watching selectedCategory
  };

  // Handle tab change
  const handleTabChange = (newTab: string | null) => {
    if (newTab !== activeTab) {
        // Clear search when tab changes? Optional.
        // setSearchQuery('');
        setActiveTab(newTab);
        // Filtering/sorting/fetching is handled by the useEffect watching activeTab
    }
  };

  // Function to clear search (passed to CharacterList)
  const clearSearch = () => {
    setSearchQuery('');
  };


  // Render loading state until client is mounted and auth state is resolved
  if (!isClient || authLoading) {
    return (
      <AppShell>
        <Center style={{ height: 'calc(100vh - 60px)' }}> {/* Adjust height as needed */}
          <Loader />
        </Center>
      </AppShell>
    );
  }

  // If auth is resolved and user is not logged in (client-side check)
  // This part might be redundant if the redirect useEffect works correctly,
  // but can serve as a fallback UI before redirect happens.
  if (!uid) {
     return (
       <AppShell>
         <Center style={{ height: 'calc(100vh - 60px)' }}>
           <Text>로그인이 필요합니다. 로그인 페이지로 이동합니다...</Text>
         </Center>
       </AppShell>
     );
  }

  // --- Original Render Logic (only when client-mounted and authenticated) ---
  return (
    <AppShell>
      <Container size="lg" px="md" py="xl">
        {/* ... rest of the component rendering (Tabs, Filters, CharacterList) ... */}
         <Group justify="space-between" mb="md">
           <Title order={2}>캐릭터 둘러보기</Title> {/* Updated Title */}
           <Group>
             <SearchFilter
               searchQuery={searchQuery}
               onChange={handleSearchChange}
               placeholder="캐릭터 검색..."
             />
             {/* <CategoryFilter
               selectedCategory={selectedCategory}
               onChange={handleCategoryChange}
             /> */}
           </Group>
         </Group>

         {/* Character Tabs */}
         <Tabs value={activeTab} onChange={handleTabChange}>
           <Tabs.List mb="md">
             <Tabs.Tab value="popular" leftSection={<IconFlame size={16} />}>
               인기순
             </Tabs.Tab>
             <Tabs.Tab value="conversation" leftSection={<IconMessages size={16} />}>
               대화순
             </Tabs.Tab>
             <Tabs.Tab value="latest" leftSection={<IconClock size={16} />}>
               최신순
             </Tabs.Tab>
             <Tabs.Tab value="name" leftSection={<IconSortAscendingLetters size={16} />}>
               이름순
             </Tabs.Tab>
           </Tabs.List>

           {/* Unified Panel Content using CharacterList */}
           {/* The key={activeTab} prop forces remount on tab change if needed, but fetchCharacters handles data reload */}
           <Tabs.Panel value="popular">
              <CharacterList
                 characters={charactersToDisplay} // Use the dynamic display list
                 loading={loadingCharacters && charactersToDisplay.length === 0} // Adjust loading condition
                 loadingMore={loadingMoreCharacters && hasMoreCharacters} // Show loader based on actual hasMore state
                 hasMore={hasMoreCharacters} // Pass the calculated hasMore state
                 onLoadMore={loadMoreCharacters}
                 searchQuery={searchQuery}
                 onClearSearch={clearSearch} // Pass clear search function
              />
           </Tabs.Panel>
           <Tabs.Panel value="conversation">
              <CharacterList
                 characters={charactersToDisplay}
                 loading={loadingCharacters && charactersToDisplay.length === 0}
                 loadingMore={loadingMoreCharacters && hasMoreCharacters}
                 hasMore={hasMoreCharacters}
                 onLoadMore={loadMoreCharacters}
                 searchQuery={searchQuery}
                 onClearSearch={clearSearch}
              />
           </Tabs.Panel>
           <Tabs.Panel value="latest">
              <CharacterList
                 characters={charactersToDisplay}
                 loading={loadingCharacters && charactersToDisplay.length === 0}
                 loadingMore={loadingMoreCharacters && hasMoreCharacters}
                 hasMore={hasMoreCharacters}
                 onLoadMore={loadMoreCharacters}
                 searchQuery={searchQuery}
                 onClearSearch={clearSearch}
              />
           </Tabs.Panel>
           <Tabs.Panel value="name">
              <CharacterList
                 characters={charactersToDisplay}
                 loading={loadingCharacters && charactersToDisplay.length === 0}
                 loadingMore={loadingMoreCharacters && hasMoreCharacters}
                 hasMore={hasMoreCharacters}
                 onLoadMore={loadMoreCharacters}
                 searchQuery={searchQuery}
                 onClearSearch={clearSearch}
              />
           </Tabs.Panel>
         </Tabs>

         {/* Observer target is now inside CharacterList */}

       </Container>
     </AppShell>
  );
}

export default function HomePageWrapper() {
 return (
   <Suspense fallback={
     <AppShell>
       <Center style={{ height: 'calc(100vh - 60px)' }}>
         <Loader />
       </Center>
     </AppShell>
   }>
     <HomePage />
   </Suspense>
 );
}