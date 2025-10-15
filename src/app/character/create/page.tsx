'use client';

import { useState, useEffect } from 'react';
import { Container, Title, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useRouter } from 'next/navigation';
import { db } from '@/firebase/config';
import { collection, addDoc, Timestamp, doc, setDoc } from 'firebase/firestore';
import { useAuth } from '@/contexts/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import CharacterForm from '@/components/character/CharacterForm'; // Import the shared form component
import { CharacterFormValues } from '@/components/character/CharacterForm'; // Import the form values type if needed elsewhere, or define locally

export default function CharacterCreatePage() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { user } = useAuth();

  // Check auth
  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user, router]);

  // Handle form submission (specific to create page)
  const handleCreateCharacter = async (values: CharacterFormValues, mainImageUrl: string, additionalImageUrls: string[]): Promise<string | void> => {
    if (!user) {
      notifications.show({ title: '오류', message: '로그인이 필요합니다.', color: 'red' });
      return;
    }

    setLoading(true);

    try {
      // 1. Add character document to Firestore
      const characterRef = await addDoc(collection(db, 'characters'), {
        name: values.name,
        description: values.description,
        image: mainImageUrl,
        additionalImages: additionalImageUrls,
        detail: values.detail,
        firstMessage: values.firstMessage,
        tags: values.tags,
        isDeleted: false,
        isPublic: values.isPublic,
        isNSFW: values.isNSFW,
        isBanmal: values.isBanmal,
        creatorId: user.uid,
        creatorName: user.displayName || user.email || 'Anonymous',
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        conversationCount: 0,
        likesCount: 0,
        likedBy: [],
        lorebookIds: values.lorebookIds || [],
        requiredImageTags: values.requiredImageTags || '',
        customEmotions: values.customEmotions || [],
      });

      const characterId = characterRef.id;

      // 2. Save gallery data to Firestore
      if (additionalImageUrls.length > 0) {
        const galleryItems = additionalImageUrls.map((url, index) => ({
          url,
          weight: values.additionalImageWeights[index] ?? 1,
          tags: values.additionalImageTags[index] ?? [],
        }));
        
        const galleryRef = doc(db, 'galleries', characterId);
        await setDoc(galleryRef, { items: galleryItems }, { merge: true });
        console.log(`Gallery data for new character ${characterId} saved.`);
      }

      notifications.show({
        title: '캐릭터 생성 완료',
        message: '캐릭터가 성공적으로 생성되었습니다!',
        color: 'green',
      });

      router.push('/home');
      return characterId;

    } catch (error) {
      console.error('Error creating character (in page):', error);
      notifications.show({
        title: '생성 실패',
        message: '캐릭터 생성 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    // Optional: Show a loading state or redirect immediately in useEffect
    return <AppShell><Container size="lg" py="xl"><Text ta="center">로그인이 필요합니다. 리디렉션 중...</Text></Container></AppShell>;
  }

  return (
    <AppShell>
      <Container size="lg" py="xl">
        <Title order={2} mb="xl">캐릭터 생성</Title>

        {/* Use the shared CharacterForm component */}
        <CharacterForm
          mode="create"
          onSubmit={handleCreateCharacter}
          loading={loading}
        />
      </Container>
    </AppShell>
  );
}