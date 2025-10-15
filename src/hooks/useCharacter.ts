import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie'; // js-cookie import 추가
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuth } from '@/contexts/AuthContext'; // useAuth 제거 (필요 시 다른 정보 위해 남겨둘 수 있음)
import { Character } from '@/types/character';
import { characterFromDoc } from '@/utils/firestoreUtils'; // Import the utility function

interface UseCharacterResult {
  character: Character | null;
  loading: boolean;
  error: string | null;
  isOwner: boolean;
}

export function useCharacter(characterId: string | undefined): UseCharacterResult {
  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  const router = useRouter();
  const { uid } = useAuth(); // user 객체가 필요하면 주석 해제

  useEffect(() => {
    const uidFromCookie = uid;

    if (!uidFromCookie) {
      // 쿠키에 uid가 없으면 로그인되지 않은 상태로 간주
      // 필요에 따라 에러 처리 또는 리다이렉션 로직 추가 가능
      // setError('로그인이 필요합니다.');
      // 필요하다면 에러 메시지를 설정하거나 다른 처리를 할 수 있습니다.
      // setError('로그인이 필요합니다.');
      // setLoading(false);
      return;
    }

    if (!characterId) {
      setError('잘못된 캐릭터 ID입니다.');
      setLoading(false);
      return;
    }

    const fetchCharacter = async () => {
      // Check cache first
      // Removed localStorage cache check

      setLoading(true);
      setError(null); // Reset error state on new fetch
      try {
        const characterDocRef = doc(db, 'characters', characterId);
        const characterDocSnap = await getDoc(characterDocRef);

        if (characterDocSnap.exists()) {
          // Use the utility function to convert the document snapshot
          const characterData = characterFromDoc(characterDocSnap);

          if (characterData) {
            setCharacter(characterData);
            // Removed localStorage cache saving
          } else {
            // Handle case where conversion fails (e.g., invalid data)
            console.error("Failed to convert document to Character:", characterId);
            setError('캐릭터 데이터 형식이 올바르지 않습니다.');
            setCharacter(null);
            // Skip owner check if data is invalid
            setLoading(false); // Ensure loading stops
            return; // Exit fetchCharacter early
          }
          // 소유권 확인 (쿠키에서 가져온 uid 사용)
          if (uidFromCookie && characterData.creatorId === uidFromCookie) {
            setIsOwner(true);
          } else {
            setIsOwner(false);
            // 수정 페이지가 아닌 상세 페이지 등 다른 곳에서도 이 훅을 사용할 수 있으므로,
            // 소유자가 아닐 때 에러를 발생시키는 대신 isOwner 상태만 설정합니다.
            // 에러 처리는 훅을 사용하는 컴포넌트에서 isOwner 값을 확인하여 수행합니다.
            // setError('이 캐릭터를 수정할 권한이 없습니다.');
          }
        } else {
          setError('캐릭터를 찾을 수 없습니다.');
          setCharacter(null); // Ensure character state is null if not found
        }
      } catch (err) {
        console.error('Error fetching character:', err);
        setError('캐릭터 정보를 불러오는 중 오류가 발생했습니다.');
        setCharacter(null); // Ensure character state is null on error
      } finally {
        setLoading(false);
      }
    };

    fetchCharacter();
  }, [characterId, router]); // 의존성 배열에서 user 제거

  return { character, loading, error, isOwner };
}