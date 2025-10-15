import React, { useRef } from 'react'; // Removed useEffect
import { Grid, Stack, Card, Text, Center, Loader, Paper, Button } from '@mantine/core';
import type { Character } from '../../types/character';
import { CharacterCard } from './CharacterCard';
import { useIntersectionObserver } from '@/hooks/useIntersectionObserver'; // Import the custom hook

interface CharacterListProps {
  characters: Character[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  // observerTargetRef is now managed internally
  onLoadMore: () => Promise<void>; // Function to call when observer triggers
  searchQuery?: string; // Optional: for showing search results message
  onClearSearch?: () => void; // Optional: function to clear search
}

export function CharacterList({
  characters,
  loading,
  loadingMore,
  hasMore,
  // observerTargetRef, // Removed from props
  searchQuery,
  onClearSearch,
  onLoadMore,
}: CharacterListProps) {

  // Internal ref for the observer target element
  const observerTargetRef = useRef<HTMLDivElement>(null);
  // Use the custom hook for intersection observer logic
  useIntersectionObserver({
    targetRef: observerTargetRef, // Pass the ref to the target element
    onIntersect: onLoadMore,      // Callback function to execute
    enabled: hasMore && !loadingMore, // Only enable when there are more items and not currently loading more
    // options: { threshold: 0.1 } // Default threshold is 0.1, can customize if needed
  });


  // Skeleton loading state
  if (loading) {
    return (
      <Stack>
        {[1, 2, 3, 4].map((i) => (
          <Card key={i} shadow="sm" padding="lg" radius="md" withBorder>
            <Card.Section style={{ height: 160, background: '#f0f0f0' }} /> {/* Adjusted height */}
            <Text fw={500} size="lg" mt="md">
              Loading...
            </Text>
          </Card>
        ))}
      </Stack>
    );
  }

  // No characters found (initial state or after filtering)
  if (characters.length === 0) {
    // If there was a search query, show "No search results"
    if (searchQuery && onClearSearch) {
       return (
         <Paper withBorder p="xl" radius="md">
           <Stack align="center" gap="md">
             <Text ta="center" fw={500}>검색 결과가 없습니다</Text>
             <Button variant="subtle" onClick={onClearSearch}>
               모든 캐릭터 보기
             </Button>
           </Stack>
         </Paper>
       );
    }
    // Otherwise, show "No characters"
    return (
      <Text ta="center" py="xl" c="dimmed">
        캐릭터가 없습니다.
      </Text>
    );
  }

  // Render character grid
  return (
    <>
      <Grid>
        {characters.map((character) => (
          <Grid.Col key={character.id} span={{ base: 12, sm: 6, md: 3 }}>
            <CharacterCard character={character} />
          </Grid.Col>
        ))}
      </Grid>

      {/* Observer Target for infinite scrolling */}
      {/* Observer Target for infinite scrolling */}
      <div ref={observerTargetRef} style={{ height: '40px', margin: '20px 0' }}> {/* Removed debug style */}
        {loadingMore && hasMore && ( // Show loader only when loading more and there are more items
          <Center>
            <Loader size="sm" />
          </Center>
        )}
        {/* Optional: Message when no more items can be loaded */}
        {/* {!hasMore && characters.length > 0 && (
          <Center>
            <Text c="dimmed" size="sm">더 이상 불러올 캐릭터가 없습니다.</Text>
          </Center>
        )} */}
      </div>
    </>
  );
}