import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, getDocs, QuerySnapshot, DocumentData } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { Character } from '@/types/character';
import { characterFromDoc } from '@/utils/firestoreUtils';
import { filterActiveCharacters } from "@/utils/character-utils";
// Removed localStorage import

const PUBLIC_CHARACTERS_CACHE_KEY = 'allPublicCharactersData';

interface UsePublicCharactersResult {
  publicCharacters: Character[];
  loading: boolean;
  error: string | null;
  refreshPublicCharacters: () => Promise<void>;
}

// 다음 정각까지 남은 시간을 밀리초 단위로 계산하는 함수
export function usePublicCharacters(): UsePublicCharactersResult {
  const [publicCharacters, setPublicCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAndCachePublicCharacters = useCallback(async (forceRefresh = false) => {
    // 1. Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      // Removed localStorage cache check
    }

    console.log("Fetching public characters from Firestore...");
    setLoading(true);
    setError(null);
    try {
      const charactersRef = collection(db, 'characters');
      const publicCharactersQuery = query(
        charactersRef,
        where('isPublic', '==', true),
        where('isDeleted', '==', false)
      );
      const querySnapshot: QuerySnapshot<DocumentData> = await getDocs(publicCharactersQuery);

      const charactersList: Character[] = [];
      querySnapshot.forEach((doc) => {
        const character = characterFromDoc(doc);
        if (character) {
          charactersList.push(character);
        } else {
          console.warn("Failed to parse public character document:", doc.id);
        }
      });

      setPublicCharacters(filterActiveCharacters(charactersList));
      // Cache with expiry until the next hour (TTL is calculated internally by setWithExpiry)
      // Removed localStorage cache saving
      // console.log(`Public characters cached until the next hour.`); // Optional: Modify log message

    } catch (err) {
      console.error('Error fetching public characters:', err);
      setError('공개 캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
      // Don't clear existing data on error, maybe show stale data?
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAndCachePublicCharacters();
  }, [fetchAndCachePublicCharacters]);

  // Function to manually refresh data
  const refreshPublicCharacters = useCallback(async () => {
    await fetchAndCachePublicCharacters(true); // Force refresh
  }, [fetchAndCachePublicCharacters]);


  return { publicCharacters, loading, error, refreshPublicCharacters };
}