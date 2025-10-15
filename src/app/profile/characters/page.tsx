'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Container, 
  Title, 
  Paper, 
  Text, 
  Grid, 
  Card, 
  Group, 
  Badge, 
  Button, 
  Modal, 
  Stack, 
  Image,
  Tabs,
  Checkbox,
  ActionIcon,
  Alert
} from '@mantine/core';
import { useRouter } from 'next/navigation';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@/contexts/AuthContext';
import { AppShell } from '@/components/layout/AppShell';
import { SearchFilter } from '@/components/filters/SearchFilter';
import { db } from '@/firebase/config';
import { collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';
import { 
  IconTrash, 
  IconEye, 
  IconEdit, 
  IconArrowLeft, 
  IconSelectAll,
  IconSelect,
  IconRestore,
  IconTrashX
} from '@tabler/icons-react';
import { Character } from '@/types/character';
import { characterFromDoc } from '@/utils/firestoreUtils';
import { filterActiveCharacters } from '@/utils/character-utils';
import { formatDate } from '@/utils/dateUtils';
import { QuickDeleteButton } from '@/components/character/QuickDeleteButton';
import { DeleteToast } from '@/components/character/DeleteToast';
import { BulkDeleteModal } from '@/components/character/BulkDeleteModal';
import { CharacterSelector } from '@/components/character/CharacterSelector';
import { DeletedCharactersList } from '@/components/character/DeletedCharactersList';

// Define cache key for user characters
const USER_CHARACTERS_CACHE_KEY = 'userCharactersData';

export default function CharactersManagePage() {
  const [activeCharacters, setActiveCharacters] = useState<Character[]>([]);
  const [deletedCharacters, setDeletedCharacters] = useState<Character[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>('active');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(new Set());
  const [pendingDeletion, setPendingDeletion] = useState<Character | null>(null);
  
  // Modal states
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [detailModalOpened, { open: openDetailModal, close: closeDetailModal }] = useDisclosure(false);
  const [bulkDeleteModalOpened, { open: openBulkDeleteModal, close: closeBulkDeleteModal }] = useDisclosure(false);
  
  const { uid } = useAuth();
  const router = useRouter();

  // 만약 사용자가 로그인하지 않았다면 로그인 페이지로 리디렉션
  useEffect(() => {
    if (!uid) {
      router.push('/login');
    } else {
      fetchUserCharacters(false);
    }
  }, [router, uid]);

  // Fetch user's characters with separation of active and deleted
  const fetchUserCharacters = useCallback(async (forceRefresh = false) => {
    if (!uid) return;

    console.log("Fetching user characters from Firestore...");
    setLoading(true);
    try {
      const charactersRef = collection(db, 'characters');
      const charactersQuery = query(
        charactersRef,
        where('creatorId', '==', uid)
      );

      const querySnapshot = await getDocs(charactersQuery);
      const activeList: Character[] = [];
      const deletedList: Character[] = [];
      
      querySnapshot.forEach((doc) => {
        const character = characterFromDoc(doc);
        if (character) {
          if (character.isDeleted) {
            deletedList.push(character);
          } else {
            activeList.push(character);
          }
        } else {
          console.warn("Failed to parse character document:", doc.id);
        }
      });
      
      setActiveCharacters(activeList);
      setDeletedCharacters(deletedList);
    } catch (error) {
      console.error('캐릭터 로딩 에러:', error);
      notifications.show({
        title: '캐릭터 로딩 실패',
        message: '캐릭터 불러오기 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [uid]);

  // Handle quick delete with soft delete
  const handleQuickDelete = async (character: Character) => {
    try {
      const response = await fetch(`/api/character/delete?characterId=${encodeURIComponent(character.id)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Move character from active to pending deletion
        setActiveCharacters(prev => prev.filter(c => c.id !== character.id));
        setPendingDeletion(character);
      } else {
        const error = await response.json();
        notifications.show({
          title: '삭제 실패',
          message: error.error || '캐릭터 삭제 중 오류가 발생했습니다.',
          color: 'red',
        });
      }
    } catch (error) {
      console.error('캐릭터 삭제 에러:', error);
      notifications.show({
        title: '삭제 실패',
        message: '캐릭터 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle undo deletion
  const handleUndoDeletion = async () => {
    if (!pendingDeletion) return;
    
    try {
      const response = await fetch('/api/character/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ characterId: pendingDeletion.id }),
      });

      if (response.ok) {
        // Restore character to active list
        setActiveCharacters(prev => [...prev, pendingDeletion]);
        setPendingDeletion(null);
        notifications.show({
          title: '삭제 취소됨',
          message: `${pendingDeletion.name} 캐릭터 삭제가 취소되었습니다.`,
          color: 'green',
        });
      } else {
        const error = await response.json();
        notifications.show({
          title: '복구 실패',
          message: error.error || '캐릭터 복구 중 오류가 발생했습니다.',
          color: 'red',
        });
      }
    } catch (error) {
      console.error('캐릭터 복구 에러:', error);
      notifications.show({
        title: '복구 실패',
        message: '캐릭터 복구 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle confirm deletion (when toast expires)
  const handleConfirmDeletion = async () => {
    if (!pendingDeletion) return;
    
    // Move to deleted list and fetch updated data
    const updatedCharacter = { ...pendingDeletion, isDeleted: true, deletedAt: new Date() };
    setDeletedCharacters(prev => [...prev, updatedCharacter]);
    setPendingDeletion(null);
    
    notifications.show({
      title: '캐릭터 삭제됨',
      message: `${updatedCharacter.name} 캐릭터가 삭제되었습니다. 30일 후 영구 삭제됩니다.`,
      color: 'orange',
    });
  };

  // Handle bulk delete
  const handleBulkDelete = async (characters: Character[], reason?: string) => {
    try {
      const response = await fetch('/api/character/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          characterIds: characters.map(c => c.id),
          reason 
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Remove deleted characters from active list
        const deletedIds = new Set(characters.map(c => c.id));
        setActiveCharacters(prev => prev.filter(c => !deletedIds.has(c.id)));
        
        // Add to deleted list
        const updatedDeletedCharacters = characters.map(c => ({
          ...c,
          isDeleted: true,
          deletedAt: new Date(),
          deletionReason: reason
        }));
        setDeletedCharacters(prev => [...prev, ...updatedDeletedCharacters]);
        
        // Clear selection
        setSelectedCharacterIds(new Set());
        setIsSelectionMode(false);
        
        notifications.show({
          title: '일괄 삭제 완료',
          message: `${characters.length}개 캐릭터가 삭제되었습니다.`,
          color: 'green',
        });
      } else {
        const error = await response.json();
        notifications.show({
          title: '일괄 삭제 실패',
          message: error.error || '일괄 삭제 중 오류가 발생했습니다.',
          color: 'red',
        });
      }
    } catch (error) {
      console.error('일괄 삭제 에러:', error);
      notifications.show({
        title: '일괄 삭제 실패',
        message: '일괄 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Handle character restoration from deleted list
  const handleRestoreCharacter = async (character: Character) => {
    try {
      const response = await fetch('/api/character/restore', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ characterId: character.id }),
      });

      if (response.ok) {
        // Move from deleted to active
        setDeletedCharacters(prev => prev.filter(c => c.id !== character.id));
        const restoredCharacter = { ...character, isDeleted: false, deletedAt: undefined, deletionReason: undefined };
        setActiveCharacters(prev => [...prev, restoredCharacter]);
      } else {
        const error = await response.json();
        throw new Error(error.error || '복구 실패');
      }
    } catch (error) {
      console.error('캐릭터 복구 에러:', error);
      throw error;
    }
  };

  // Handle permanent deletion
  const handlePermanentDelete = async (character: Character) => {
    try {
      const response = await fetch(`/api/character/permanent?characterId=${encodeURIComponent(character.id)}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        // Remove from deleted list
        setDeletedCharacters(prev => prev.filter(c => c.id !== character.id));
      } else {
        const error = await response.json();
        throw new Error(error.error || '영구 삭제 실패');
      }
    } catch (error) {
      console.error('캐릭터 영구 삭제 에러:', error);
      throw error;
    }
  };

  // Handle character selection
  const handleSelectionChange = (characterId: string, selected: boolean) => {
    setSelectedCharacterIds(prev => {
      const newSet = new Set(prev);
      if (selected) {
        newSet.add(characterId);
      } else {
        newSet.delete(characterId);
      }
      return newSet;
    });
  };

  // Handle select all
  const handleSelectAll = () => {
    if (selectedCharacterIds.size === filteredActiveCharacters.length) {
      setSelectedCharacterIds(new Set());
    } else {
      setSelectedCharacterIds(new Set(filteredActiveCharacters.map(c => c.id)));
    }
  };

  // Handle character deletion (legacy modal)
  const deleteCharacter = async () => {
    if (!selectedCharacter) return;
    
    try {
      await deleteDoc(doc(db, 'characters', selectedCharacter.id));
      
      // Update local state
      const updatedCharacters = activeCharacters.filter(char => char.id !== selectedCharacter.id);
      setActiveCharacters(updatedCharacters);

      notifications.show({
        title: '캐릭터 삭제 완료',
        message: `${selectedCharacter.name} 캐릭터가 삭제되었습니다.`,
        color: 'green',
      });

      closeDeleteModal();
    } catch (error) {
      console.error('캐릭터 삭제 에러:', error);
      notifications.show({
        title: '캐릭터 삭제 실패',
        message: '캐릭터 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  // Open character detail modal
  const handleViewDetail = (character: Character) => {
    setSelectedCharacter(character);
    openDetailModal();
  };

  // Filter active characters based on search query
  const filteredActiveCharacters = useMemo(() => {
    const base = filterActiveCharacters(activeCharacters);
    if (!searchQuery.trim()) {
      return base;
    }
    
    const query = searchQuery.toLowerCase().trim();
    return base.filter(character =>
      character.name.toLowerCase().includes(query) ||
      character.description.toLowerCase().includes(query) ||
      character.tags.some(tag => tag.toLowerCase().includes(query))
    );
  }, [activeCharacters, searchQuery]);

  // Get selected characters for bulk operations
  const selectedCharacters = useMemo(() => {
    return filteredActiveCharacters.filter(c => selectedCharacterIds.has(c.id));
  }, [filteredActiveCharacters, selectedCharacterIds]);

  if (!uid) {
    return <Text ta="center" py="xl">로그인이 필요합니다...</Text>;
  }

  // Handle search query change
  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
  };

  return (
    <AppShell>
      <Container size="lg" py="xl">
        <Group mb="xl">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => router.push('/profile')}
          >
            프로필로 돌아가기
          </Button>
          <Title order={2}>내 캐릭터 관리</Title>
        </Group>

        <Tabs value={activeTab} onChange={setActiveTab} mb="md">
          <Tabs.List>
            <Tabs.Tab value="active">
              활성 캐릭터 ({activeCharacters.length})
            </Tabs.Tab>
            <Tabs.Tab value="deleted">
              삭제된 캐릭터 ({deletedCharacters.length})
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="active">
            <Group justify="space-between" mb="md">
              <SearchFilter
                searchQuery={searchQuery}
                onChange={handleSearchChange}
                placeholder="이름, 설명, 태그로 검색..."
              />
              <Group>
                {activeCharacters.length > 0 && (
                  <Button
                    variant="light"
                    leftSection={isSelectionMode ? <IconSelect size={16} /> : <IconSelectAll size={16} />}
                    onClick={() => {
                      setIsSelectionMode(!isSelectionMode);
                      setSelectedCharacterIds(new Set());
                    }}
                  >
                    {isSelectionMode ? '선택 모드 종료' : '일괄 선택'}
                  </Button>
                )}
                <Button
                  onClick={() => router.push('/character/create')}
                >
                  새 캐릭터 생성
                </Button>
              </Group>
            </Group>

            {isSelectionMode && activeCharacters.length > 0 && (
              <Group justify="space-between" mb="md" p="sm" style={{ backgroundColor: 'var(--mantine-color-blue-0)', borderRadius: '8px' }}>
                <Group>
                  <Checkbox
                    checked={selectedCharacterIds.size === filteredActiveCharacters.length && filteredActiveCharacters.length > 0}
                    indeterminate={selectedCharacterIds.size > 0 && selectedCharacterIds.size < filteredActiveCharacters.length}
                    onChange={handleSelectAll}
                    label={`${selectedCharacterIds.size}개 선택됨`}
                  />
                </Group>
                <Group>
                  <Button
                    variant="light"
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={openBulkDeleteModal}
                    disabled={selectedCharacterIds.size === 0}
                  >
                    선택된 캐릭터 삭제 ({selectedCharacterIds.size})
                  </Button>
                </Group>
              </Group>
            )}
            
            {loading ? (
              <Text ta="center" py="xl">로딩 중...</Text>
            ) : activeCharacters.length > 0 ? (
              <>
                {filteredActiveCharacters.length > 0 ? (
                  <Grid>
                    {filteredActiveCharacters.map((character) => (
                      <Grid.Col key={character.id} span={{ base: 12, sm: 6, lg: 4 }}>
                        {isSelectionMode ? (
                          <CharacterSelector
                            character={character}
                            selected={selectedCharacterIds.has(character.id)}
                            onSelectionChange={handleSelectionChange}
                          />
                        ) : (
                          <Card shadow="sm" padding="lg" radius="md" withBorder>
                            <Card.Section>
                              <Image
                                src={character.image}
                                height={160}
                                alt={character.name}
                                fallbackSrc="https://placehold.co/600x400?text=No+Image"
                              />
                            </Card.Section>
                            
                            <Group justify="space-between" mt="md" mb="xs">
                              <Text fw={500}>{character.name}</Text>
                              <Group gap={5}>
                                {!character.isPublic && (
                                  <Badge color="gray" variant="light">
                                    비공개
                                  </Badge>
                                )}
                                {character.isNSFW && (
                                  <Badge color="red" variant="light">
                                    NSFW
                                  </Badge>
                                )}
                              </Group>
                            </Group>
                            
                            <Text size="sm" c="dimmed" lineClamp={2}>
                              {character.description}
                            </Text>
                            
                            <Group mt="md">
                              {character.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="light">
                                  {tag}
                                </Badge>
                              ))}
                              {character.tags.length > 3 && (
                                <Badge variant="light">+{character.tags.length - 3}</Badge>
                              )}
                            </Group>
                            
                            <Group mt="xs" justify="space-between">
                              <Group gap={4}>
                                <Text size="xs" c="dimmed">💬 {character.conversationCount}</Text>
                              </Group>
                              <Group gap={4}>
                                <Text size="xs" c="dimmed">❤️ {character.likesCount}</Text>
                              </Group>
                            </Group>
                            
                            <Text size="xs" c="dimmed" mt="sm">
                              생성일: {formatDate(character.createdAt)}
                            </Text>
                            
                            <Group mt="md" justify="space-between">
                              <Button
                                variant="light"
                                color="blue"
                                size="sm"
                                leftSection={<IconEye size={16} />}
                                onClick={() => handleViewDetail(character)}
                              >
                                상세보기
                              </Button>
                              
                              <Group>
                                <Button
                                  variant="light"
                                  color="grape"
                                  size="sm"
                                  leftSection={<IconEdit size={16} />}
                                  onClick={() => router.push(`/character/edit/${character.id}`)}
                                >
                                  수정
                                </Button>
                                
                                <QuickDeleteButton
                                  character={character}
                                  onDelete={handleQuickDelete}
                                  size="sm"
                                />
                              </Group>
                            </Group>
                          </Card>
                        )}
                      </Grid.Col>
                    ))}
                  </Grid>
                ) : (
                  <Paper withBorder p="xl" radius="md">
                    <Stack align="center" gap="md">
                      <Text ta="center" fw={500}>검색 결과가 없습니다</Text>
                      <Button variant="subtle" onClick={() => setSearchQuery('')}>
                        모든 캐릭터 보기
                      </Button>
                    </Stack>
                  </Paper>
                )}
              </>
            ) : (
              <Paper withBorder p="xl" radius="md">
                <Stack align="center" gap="md">
                  <Text ta="center" fw={500}>아직 생성한 캐릭터가 없습니다</Text>
                  <Button onClick={() => router.push('/character/create')}>
                    첫 캐릭터 만들기
                  </Button>
                </Stack>
              </Paper>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="deleted">
            <DeletedCharactersList
              characters={deletedCharacters}
              onRestore={handleRestoreCharacter}
              onPermanentDelete={handlePermanentDelete}
              loading={loading}
            />
          </Tabs.Panel>
        </Tabs>
        
        {/* Delete Confirmation Modal (Legacy) */}
        <Modal
          opened={deleteModalOpened}
          onClose={closeDeleteModal}
          title="캐릭터 삭제 확인"
        >
          <Text mb="lg">
            정말로 <Text span fw={700}>{selectedCharacter?.name}</Text> 캐릭터를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
          </Text>
          
          <Group justify="flex-end">
            <Button variant="default" onClick={closeDeleteModal}>
              취소
            </Button>
            <Button color="red" onClick={deleteCharacter}>
              삭제
            </Button>
          </Group>
        </Modal>
        
        {/* Character Detail Modal */}
        <Modal
          opened={detailModalOpened}
          onClose={closeDetailModal}
          title={selectedCharacter?.name}
          size="lg"
        >
          {selectedCharacter && (
            <Stack>
              <Image
                src={selectedCharacter.image}
                height={200}
                alt={selectedCharacter.name}
                fit="contain"
                fallbackSrc="https://placehold.co/600x400?text=No+Image"
              />
              
              <Text fw={500}>설명</Text>
              <Text>{selectedCharacter.description}</Text>
              
              <Text fw={500}>상세 설정</Text>
              <Paper withBorder p="sm" style={{ maxHeight: '200px', overflow: 'auto' }}>
                <Text style={{ whiteSpace: 'pre-wrap' }}>{selectedCharacter.detail}</Text>
              </Paper>
              
              <Text fw={500}>첫 메시지</Text>
              <Paper withBorder p="sm">
                <Text style={{ whiteSpace: 'pre-wrap' }}>{selectedCharacter.firstMessage}</Text>
              </Paper>
              
              <Group>
                <Text fw={500}>태그:</Text>
                {selectedCharacter.tags.map((tag) => (
                  <Badge key={tag} variant="light">
                    {tag}
                  </Badge>
                ))}
              </Group>
              
              <Group>
                <Text fw={500}>공개 여부:</Text>
                <Badge color={selectedCharacter.isPublic ? 'green' : 'gray'}>
                  {selectedCharacter.isPublic ? '공개' : '비공개'}
                </Badge>
                
                {selectedCharacter.isNSFW && (
                  <Badge color="red">NSFW</Badge>
                )}
              </Group>
            </Stack>
          )}
        </Modal>

        {/* Bulk Delete Modal */}
        <BulkDeleteModal
          opened={bulkDeleteModalOpened}
          onClose={closeBulkDeleteModal}
          characters={selectedCharacters}
          onConfirm={handleBulkDelete}
          loading={loading}
        />

        {/* Delete Toast */}
        {pendingDeletion && (
          <DeleteToast
            character={pendingDeletion}
            onUndo={handleUndoDeletion}
            onConfirm={handleConfirmDeletion}
            duration={5}
          />
        )}
      </Container>
    </AppShell>
  );
}