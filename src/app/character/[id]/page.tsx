'use client';

import { useState, useEffect } from 'react'; // Keep useEffect for isLiked calculation for now
import { Container, Paper, Text, Stack, Button, Loader, Grid, Divider, Modal, Group } from '@mantine/core'; // Re-added necessary Mantine components
import { useRouter, useParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { db } from '@/firebase/config';
import { doc, updateDoc, arrayUnion, arrayRemove, collection, setDoc, Timestamp, getDoc } from 'firebase/firestore';
import { IconArrowLeft, IconAlertCircle } from '@tabler/icons-react'; // Re-added necessary icons
import { notifications } from '@mantine/notifications';
import { v4 as uuidv4 } from 'uuid';
// Import the new components
import { CharacterDetailHeader } from '@/components/character/detail/CharacterDetailHeader';
import { CharacterInfoCard } from '@/components/character/detail/CharacterInfoCard';
import { CharacterTabs } from '@/components/character/detail/CharacterTabs';
import { DeleteToast } from '@/components/character/DeleteToast';
import { useCharacter } from '@/hooks/useCharacter';
import { Character } from '@/types/character';
import CommentSection from '@/components/comment/CommentSection'; // 댓글 섹션 컴포넌트 임포트

// Removed the local Character interface definition

export default function CharacterDetailPage() {
  // Use state from the hook instead
  const [localCharacter, setLocalCharacter] = useState<Character | null>(null); // For local updates (like, count)
  const [isLiked, setIsLiked] = useState(false);
  const [likeLoading, setLikeLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showDeleteToast, setShowDeleteToast] = useState(false);
  const [deletedCharacter, setDeletedCharacter] = useState<Character | null>(null);
  const router = useRouter();
  const params = useParams();
  const { user } = useAuth();
  const characterId = params?.id as string;
  // Removed duplicate user declaration
  const { character: fetchedCharacter, loading: loadingCharacter, error: fetchError, isOwner } = useCharacter(characterId);
  const isPrivileged = !!(user?.isAdmin || (user as any)?.isSubadmin);

  // Update local state when fetched character changes
  useEffect(() => {
    setLocalCharacter(fetchedCharacter);
  }, [fetchedCharacter]);

  // Calculate isLiked based on the localCharacter and user
  useEffect(() => {
    if (user && localCharacter?.likedBy.includes(user.uid)) {
      setIsLiked(true);
    } else {
      setIsLiked(false);
    }
  }, [localCharacter, user]);

  // Determine view permission error
  const permissionError = !loadingCharacter && localCharacter && !localCharacter.isPublic && !isOwner && !(user?.isAdmin || (user as any)?.isSubadmin)
    ? '이 캐릭터를 볼 수 있는 권한이 없습니다.'
    : null;

  // Combine fetch error and permission error
  const displayError = fetchError || permissionError;

  // Re-add likeLoading state
  // Removed duplicate likeLoading state declaration

  // Handle like/unlike
  const handleLike = async () => {
    // Use localCharacter for checks and updates
    if (!user || !localCharacter) {
      notifications.show({
        title: '로그인 필요',
        message: '좋아요 기능을 사용하려면 로그인이 필요합니다.',
        color: 'yellow',
      });
      return;
    }
    
    setLikeLoading(true);
    const characterRef = doc(db, 'characters', localCharacter.id); // Define characterRef here

    try {
      if (isLiked) {
        // Unlike
        await updateDoc(characterRef, {
          likesCount: Math.max(0, (localCharacter.likesCount || 0) - 1),
          likedBy: arrayRemove(user.uid)
        });
        setLocalCharacter((prev: Character | null) => prev ? { // Add type to prev
          ...prev,
          likesCount: Math.max(0, (prev.likesCount || 0) - 1),
          likedBy: prev.likedBy.filter(id => id !== user.uid)
        } : null);
        // Removed incorrect closing bracket });
        
        setIsLiked(false);
        notifications.show({
          title: '좋아요 취소',
          message: '캐릭터 좋아요를 취소했습니다.',
          color: 'blue',
        });
      } else {
        // Like
        await updateDoc(characterRef, {
          likesCount: (localCharacter.likesCount || 0) + 1,
          likedBy: arrayUnion(user.uid)
        });
        
        // Update local state immediately
        setLocalCharacter(prev => prev ? {
          ...prev,
          likesCount: (prev.likesCount || 0) + 1,
          likedBy: [...prev.likedBy, user.uid]
        } : null);
        // Removed incorrect closing bracket });
        
        setIsLiked(true);
        notifications.show({
          title: '좋아요',
          message: '캐릭터에 좋아요를 표시했습니다.',
          color: 'green',
        });
      }
    } catch (error) {
      console.error('Error updating like status:', error);
      notifications.show({
        title: '오류 발생',
        message: '좋아요 상태를 업데이트하는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLikeLoading(false);
    }
  }; // End of handleLike function

  // --- Move handleStartChat, handleEdit, formatDate inside the component function ---

  const handleStartChat = async () => {
    // Removed duplicate function definition start
    if (!localCharacter || !user) {
       notifications.show({
        title: '로그인 필요',
        message: '채팅을 시작하려면 로그인이 필요합니다.',
        color: 'yellow',
      });
      return;
    }
    
    try {
      // Increment conversation count
      const characterRef = doc(db, 'characters', localCharacter.id);
      await updateDoc(characterRef, {
        conversationCount: (localCharacter.conversationCount || 0) + 1
      });
      
      // Update local state
      setLocalCharacter((prev: Character | null) => prev ? { // Add type to prev
        ...prev,
        conversationCount: (prev.conversationCount || 0) + 1
      } : null);
      // Removed incorrect closing bracket });
      
      // Create a chat room directly
      const roomName = `${localCharacter.name}`;
      const roomDescription = ``;
      
      // Create tags array from character tags
      const tagsArray = localCharacter.tags || [];
      
      // Create a chat room with the character
      const roomId = uuidv4();
      await setDoc(doc(db, 'chatRooms', roomId), {
        name: roomName,
        description: roomDescription,
        creatorId: user.uid,
        creatorName: user.displayName,
        image: localCharacter.image,
        members: 1,
        createdAt: Timestamp.now(),
        lastUpdated: Timestamp.now(),
        tags: tagsArray,
        isNSFW: localCharacter.isNSFW,
        characterId: localCharacter.id,
        // Embed necessary character info, using localCharacter
        character: {
          id: localCharacter.id,
          name: localCharacter.name,
          description: localCharacter.description,
          image: localCharacter.image,
          detail: localCharacter.detail,
          firstMessage: localCharacter.firstMessage,
          isNSFW: localCharacter.isNSFW,
          isBanmal: localCharacter.isBanmal || false,
          creatorId: localCharacter.creatorId,
          tags: localCharacter.tags || [],
          // Embed counts and likes from the current local state
          conversationCount: localCharacter.conversationCount || 0,
          likesCount: localCharacter.likesCount || 0,
          likedBy: localCharacter.likedBy || [],
        },
        messages: [],
        lastMessage: '',
      });
      
      // Generate bot's first message
      try {
        // Create a default bot first message
        const defaultMessage = {
          id: uuidv4(),
          senderId: 'bot',
          senderName: localCharacter.name,
          senderAvatar: localCharacter.image || '',
          isCharacter: true,
          characterId: localCharacter.id,
          text: localCharacter.firstMessage || `안녕하세요, ${user.displayName || '사용자'}님! 저는 ${localCharacter.name}입니다.`,
          imageUrl: '',
          timestamp: new Date(),
        };
        
        // Update the chat room with the bot's first message
        await updateDoc(doc(db, 'chatRooms', roomId), {
          messages: [defaultMessage],
          lastMessage: defaultMessage.text,
          lastUpdated: Timestamp.now(),
        });
        
        // Update user's recent chats
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        
        if (userDoc.exists()) {
          await updateDoc(userDocRef, {
            recentChats: arrayUnion(roomId)
          });
        } else {
          // Initialize user document if it doesn't exist
          await setDoc(userDocRef, {
            displayName: user.displayName || '사용자',
            email: user.email || '',
            photoURL: user.photoURL || '',
            createdAt: Timestamp.now(),
            recentChats: [roomId],
            settings: {
              theme: 'light',
              notifications: true
            }
          });
        }
        
        // Navigate to the new chat room
        router.push(`/chat/${roomId}`);
      } catch (messageError) { // Changed variable name
        console.error('Bot 첫 메시지 생성 에러:', messageError);
        // Navigate to the chat room even if there's an error with the first message
        router.push(`/chat/${roomId}`);
      }
    } catch (roomError) { // Changed variable name
      console.error('Error creating chat room:', roomError);
      notifications.show({
        title: '오류 발생',
        message: '채팅방 생성 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  }; // End of handleStartChat function

  const handleEdit = () => {
    // Use localCharacter
    if (localCharacter) {
      router.push(`/character/edit/${localCharacter.id}`);
    }
  };

  // 삭제 버튼 클릭 함수 (모달 표시)
  const handleDeleteClick = () => {
    setShowDeleteModal(true);
  };

  // 모달에서 삭제 확인 함수
  const handleDeleteConfirm = () => {
    if (!localCharacter) return;
    
    setShowDeleteModal(false);
    setDeletedCharacter(localCharacter);
    setShowDeleteToast(true);
  };

  // 모달에서 취소 함수
  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
  };

  // 삭제 취소 함수
  const handleDeleteUndo = () => {
    setShowDeleteToast(false);
    setDeletedCharacter(null);
    notifications.show({
      title: '삭제 취소',
      message: '캐릭터 삭제가 취소되었습니다.',
      color: 'blue',
    });
  };

  // 삭제 확정 함수 (실제 삭제 수행)
  const handleDeleteFinalize = async () => {
    if (!deletedCharacter) return;

    try {
      const response = await fetch(
        `/api/character/delete?characterId=${encodeURIComponent(deletedCharacter.id)}&reason=${encodeURIComponent('사용자 요청에 의한 삭제')}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        throw new Error('삭제 요청 실패');
      }

      setShowDeleteToast(false);
      setDeletedCharacter(null);
      
      notifications.show({
        title: '삭제 완료',
        message: '캐릭터가 성공적으로 삭제되었습니다.',
        color: 'green',
      });

      // 프로필 페이지로 리다이렉트
      router.push('/profile/characters');
      
    } catch (error) {
      console.error('캐릭터 삭제 오류:', error);
      setShowDeleteToast(false);
      setDeletedCharacter(null);
      
      notifications.show({
        title: '삭제 실패',
        message: '캐릭터 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Removed the local formatDate function definition

  // --- Conditional Rendering using hook state ---

  // isOwner is already provided by the useCharacter hook
  // const isCreator = user?.uid === localCharacter?.creatorId;

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
        
        {/* Conditional Rendering Logic Moved Here */}
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

        {!loadingCharacter && !displayError && localCharacter && (
          <Paper withBorder shadow="md" p="xl" radius="md">
            <Stack>
              {/* Use CharacterDetailHeader */}
              <CharacterDetailHeader
                character={localCharacter}
                isOwner={isOwner || isPrivileged}
                onEdit={handleEdit}
                onStartChat={handleStartChat}
                onDelete={handleDeleteClick}
                isChatDisabled={!user}
              />

              <Divider my="md" />

              <Grid>
                {/* Use CharacterInfoCard */}
                <Grid.Col span={{ base: 12, md: 4 }}>
                  <CharacterInfoCard
                    character={localCharacter}
                    isLiked={isLiked}
                    likeLoading={likeLoading}
                    onLike={handleLike}
                    isLikeDisabled={!user}
                    // Removed formatDate prop as it's now imported directly in CharacterInfoCard
                  />
                </Grid.Col>

                {/* Use CharacterTabs */}
                <Grid.Col span={{ base: 12, md: 8 }}>
                  <CharacterTabs character={localCharacter} />
                </Grid.Col>
              </Grid>

              {/* 댓글 섹션 추가 */}
              <Divider my="lg" />
              <CommentSection characterId={localCharacter.id} />

            </Stack>
          </Paper>
        )}

        {/* Fallback for unexpected states */}
        {!loadingCharacter && !displayError && !localCharacter && (
           <Text ta="center" mt="xl">캐릭터 정보를 표시할 수 없습니다.</Text>
        )}
        {/* Removed duplicate conditional rendering block */}
        
        {/* 삭제 확인 모달 */}
        <Modal
          opened={showDeleteModal}
          onClose={handleDeleteCancel}
          title="캐릭터 삭제"
          size="sm"
        >
          <Text mb="md">
            &apos;{localCharacter?.name}&apos; 캐릭터를 정말 삭제하시겠습니까?
          </Text>
          <Text size="sm" c="dimmed" mb="lg">
            삭제된 캐릭터는 휴지통에서 복구할 수 있습니다.
          </Text>
          <Group justify="flex-end">
            <Button variant="outline" onClick={handleDeleteCancel}>
              취소
            </Button>
            <Button color="red" onClick={handleDeleteConfirm}>
              삭제
            </Button>
          </Group>
        </Modal>

        {/* 삭제 토스트 */}
        {showDeleteToast && deletedCharacter && (
          <DeleteToast
            character={deletedCharacter}
            onUndo={handleDeleteUndo}
            onConfirm={handleDeleteFinalize}
            duration={5}
          />
        )}
      </Container>
    </AppShell>
  );
} // End of CharacterDetailPage component function