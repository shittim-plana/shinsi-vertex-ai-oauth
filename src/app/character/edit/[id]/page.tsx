'use client';

import { useState, useEffect } from 'react'; // Re-added useEffect
import { Container, Title, Text, Paper, Stack, Button, Loader } from '@mantine/core'; // Added Loader
import { notifications } from '@mantine/notifications';
import { useRouter, useParams } from 'next/navigation';
import { db } from '@/firebase/config';
import { doc, updateDoc, Timestamp, setDoc, getDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import CharacterForm from '@/components/character/CharacterForm';
import { CharacterFormValues } from '@/components/character/CharacterForm';
// Character type is now implicitly handled by useCharacter hook, but keep if needed elsewhere or for clarity
// import { Character } from '@/types/character';
import { IconArrowLeft, IconAlertCircle } from '@tabler/icons-react'; // Added IconAlertCircle
import { useCharacter } from '@/hooks/useCharacter'; // Import the custom hook
import { Gallery } from '@/types/gallery';

export default function CharacterEditPage() {
  const [updating, setUpdating] = useState(false); // Renamed loading to updating for clarity
  const [galleryData, setGalleryData] = useState<Gallery | null>(null);

  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const characterId = params?.id as string;
  const { character, loading: loadingCharacter, error: fetchError, isOwner } = useCharacter(characterId);

  // Redirect if user is not logged in
  useEffect(() => {
    if (!user && !loadingCharacter) {
        router.push('/login');
    }
  }, [user, loadingCharacter, router]);

  // Fetch gallery data once character is loaded
  useEffect(() => {
    const fetchGalleryData = async () => {
      if (characterId) {
        const galleryRef = doc(db, 'galleries', characterId);
        const gallerySnap = await getDoc(galleryRef);
        if (gallerySnap.exists()) {
          setGalleryData(gallerySnap.data() as Gallery);
        } else {
          setGalleryData(null); // No gallery data found
        }
      }
    };

    if (isOwner) {
        fetchGalleryData();
    }
  }, [characterId, isOwner]);

  // Handle form submission (specific to edit page)
  const handleUpdateCharacter = async (values: CharacterFormValues, mainImageUrl: string | null, additionalImageUrls: string[]): Promise<void> => {
    if (!user || !character || !isOwner) {
      notifications.show({
        title: '오류',
        message: '캐릭터를 수정할 권한이 없거나 데이터가 올바르지 않습니다.',
        color: 'red',
      });
      return;
    }

    setUpdating(true);

    try {
      const characterId = character.id;

      // 1. Update character document in Firestore
      await updateDoc(doc(db, 'characters', characterId), {
        name: values.name,
        description: values.description,
        image: mainImageUrl ?? '',
        additionalImages: additionalImageUrls,
        detail: values.detail,
        firstMessage: values.firstMessage,
        tags: values.tags,
        isPublic: values.isPublic,
        isNSFW: values.isNSFW,
        isBanmal: values.isBanmal,
        updatedAt: Timestamp.now(),
        creatorId: character.creatorId,
        creatorName: character.creatorName,
        createdAt: character.createdAt instanceof Date ? Timestamp.fromDate(character.createdAt) : character.createdAt,
        conversationCount: character.conversationCount,
        likesCount: character.likesCount,
        likedBy: character.likedBy,
        lorebookIds: values.lorebookIds || [],
        requiredImageTags: values.requiredImageTags || '',
        customEmotions: values.customEmotions || [],
      });
      
      // 2. Upsert gallery data to Firestore (merge)
      const items: Gallery['items'] = (additionalImageUrls || []).map((url, idx) => ({
        url,
        weight: (Number(values?.additionalImageWeights?.[idx] ?? 1) | 0),
        tags: Array.isArray(values?.additionalImageTags?.[idx]) ? values.additionalImageTags[idx] : [],
      }));
      
      const galleryRef = doc(db, 'galleries', characterId);
      // 개발용 로깅: 저장 직전 샘플 출력 (프로덕션에서 제거 가능)
      console.debug('[gallery/upsert]', { count: items.length, sample: items.slice(0, 1) });
      await setDoc(galleryRef, { items }, { merge: true });


      notifications.show({
        title: '캐릭터 수정 완료',
        message: '캐릭터가 성공적으로 수정되었습니다!',
        color: 'green',
      });

      router.push(`/character/${characterId}`);

    } catch (error) {
        console.error('Error updating character (in page):', error);
        notifications.show({
            title: '수정 실패',
            message: '캐릭터 수정 중 오류가 발생했습니다.',
            color: 'red',
        });
    } finally {
      setUpdating(false);
    }
  };

  // Determine the final error message, considering fetch error and ownership
  const displayError = fetchError || (!loadingCharacter && character && !isOwner)
    ? (fetchError || '이 캐릭터를 수정할 권한이 없습니다.')
    : null;

  return (
    <AppShell>
      <Container size="lg" py="xl">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => router.back()}
          mb="md"
        >
          뒤로 가기
        </Button>
        <Title order={2} mb="xl">캐릭터 수정</Title>

        {loadingCharacter && (
          <Stack align="center" py="xl">
            <Loader />
            <Text>캐릭터 정보 로딩 중...</Text>
          </Stack>
        )}

        {displayError && !loadingCharacter && (
          <Paper withBorder shadow="md" p="xl" radius="md" mt="xl">
            <Stack align="center">
              <IconAlertCircle size={48} color="red" />
              <Text color="red" ta="center">{displayError}</Text>
              <Button
                variant="outline"
                leftSection={<IconArrowLeft size={16} />}
                onClick={() => router.back()}
                mt="md"
              >
                뒤로 가기
              </Button>
            </Stack>
          </Paper>
        )}

        {!loadingCharacter && !displayError && character && isOwner && (
          <CharacterForm
            mode="edit"
            initialData={character}
            initialGalleryData={galleryData}
            onSubmit={handleUpdateCharacter}
            loading={updating} // Pass the updating state to the form
          />
        )}

        {/* Fallback for unexpected states, though ideally covered above */}
        {!loadingCharacter && !displayError && !character && (
           <Text ta="center" mt="xl">캐릭터 정보를 표시할 수 없습니다.</Text>
        )}
      </Container>
    </AppShell>
  );
}