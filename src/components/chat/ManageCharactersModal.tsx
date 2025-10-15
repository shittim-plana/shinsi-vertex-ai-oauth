import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Stack, Paper, Text, MultiSelect, Button, ScrollArea, Group, ThemeIcon, Avatar, Checkbox, ActionIcon, Badge, Loader } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconUserCheck, IconUserOff, IconTrash } from '@tabler/icons-react';
import { ChatRoom } from '@/types/chat';
import type { Character } from '@/types/character';
import { db } from '@/firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore'; // Removed documentId import as it's not used here for now
import { usePublicCharacters } from '@/hooks/usePublicCharacters'; // Import hook for public characters
import { characterFromDoc } from '@/utils/firestoreUtils'; // Import utility function
import { filterActiveCharacters } from '@/utils/character-utils';
// Removed localStorage utils and cache key as we fetch directly now

interface ManageCharactersModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatRoom: ChatRoom | null;
  userId: string; // Add userId prop
  charactersToAdd: string[];
  setCharactersToAdd: (ids: string[]) => void;
  handleAddCharacters: (ids: string[]) => void;
  handleToggleCharacterActive: (id: string) => void;
  handleRemoveCharacter: (id: string) => void;
}

const ManageCharactersModal: React.FC<ManageCharactersModalProps> = ({
  isOpen,
  onClose,
  chatRoom,
  userId, // Destructure userId from props
  charactersToAdd,
  setCharactersToAdd,
  handleAddCharacters,
  handleToggleCharacterActive,
  handleRemoveCharacter,
}) => {
  // --- State Declarations ---
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm] = useDebouncedValue(searchTerm, 300);
  const [userCharacters, setUserCharacters] = useState<Character[]>([]); // State for user's own characters
  const [loadingUserCharacters, setLoadingUserCharacters] = useState(true); // Loading state for user characters

  // Use the hook to get public characters
  const { publicCharacters, loading: loadingPublicCharacters } = usePublicCharacters();

  // --- useEffect for fetching user's characters ---
  useEffect(() => {
    const fetchUserCharacters = async () => {
      if (!userId) {
        setLoadingUserCharacters(false);
        return; // No user ID, cannot fetch
      }
      setLoadingUserCharacters(true);
      try {
        const charactersRef = collection(db, 'characters');
        const q = query(
          charactersRef,
          where('creatorId', '==', userId),
          where('isDeleted', '==', false)
        );
        const querySnapshot = await getDocs(q);
        const charactersList: Character[] = [];
        querySnapshot.forEach((doc) => {
          const character = characterFromDoc(doc);
          if (character) {
            charactersList.push(character);
          }
        });
        setUserCharacters(filterActiveCharacters<Character>(charactersList));
      } catch (error) {
        console.error("Error fetching user characters:", error);
        // Handle error appropriately
      } finally {
        setLoadingUserCharacters(false);
      }
    };

    if (isOpen) { // Fetch only when the modal is open
        fetchUserCharacters();
    }
  }, [userId, isOpen]); // Re-fetch if userId changes or modal opens

  // --- useMemo for preparing MultiSelect data ---
  const multiSelectData = useMemo(() => {
    const currentMemberIds = new Set(
      (chatRoom?.characters || [])
        .filter(c => (c as any)?.isDeleted !== true)
        .map(c => c.id)
    );

    // Group 1: User's private characters (excluding current members)
    const myPrivateChars = userCharacters
      .filter(char => !char.isPublic && !currentMemberIds.has(char.id))
      .map(char => ({ value: char.id, label: char.name }));

    // Group 2: All public characters (excluding current members)
    const publicCharsMap = new Map(publicCharacters.map(char => [char.id, char]));
    const publicCharItems = Array.from(publicCharsMap.values())
      .filter(char => !currentMemberIds.has(char.id)) // Exclude current members
      .map(char => ({
        value: char.id,
        label: char.creatorId === userId ? `${char.name} (내 공개 캐릭터)` : `${char.name} (공개)`
      }));

    const baseData = [
      // No '기본' option needed for adding characters
      { group: '내 비공개 캐릭터', items: myPrivateChars },
      { group: '공개 캐릭터', items: publicCharItems }
    ].filter(group => group.items.length > 0);

    // Apply client-side search filtering based on debouncedSearchTerm
    if (!debouncedSearchTerm.trim()) {
      return baseData; // Return all groups if no search term
    }
    const searchTermLower = debouncedSearchTerm.toLowerCase();
    return baseData.map(group => ({
      ...group,
      items: group.items.filter(item => item.label.toLowerCase().includes(searchTermLower))
    })).filter(group => group.items.length > 0);

  }, [userCharacters, publicCharacters, debouncedSearchTerm, userId, chatRoom?.characters]);

  // --- Return Statement ---
  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="채팅 참여 캐릭터 관리"
      size="lg" // Larger modal
      centered
    >
      <Stack>
        {/* Section to Add Characters */}
        <Paper withBorder p="sm" radius="sm">
          <Text fw={500} mb="xs">캐릭터 추가</Text>
          <MultiSelect
            data={multiSelectData} // Use new memoized data
            value={charactersToAdd}
            onChange={setCharactersToAdd}
            placeholder="추가할 캐릭터 이름 검색..."
            searchable
            searchValue={searchTerm}
            onSearchChange={setSearchTerm}
            nothingFoundMessage={searchTerm ? "검색 결과가 없습니다." : "추가할 캐릭터가 없습니다."}
            clearable
            disabled={loadingUserCharacters || loadingPublicCharacters} // Disable while loading either list
            rightSection={loadingUserCharacters || loadingPublicCharacters ? <Loader size="xs" /> : null} // Show loader
            mb="sm"
          />
          <Button
            onClick={() => {
              handleAddCharacters(charactersToAdd);
            }}
            disabled={charactersToAdd.length === 0}
            size="xs"
          >
            선택한 캐릭터 추가
          </Button>
        </Paper>

        {/* Section to Manage Existing Characters */}
        <Text fw={500} mt="md">현재 참여 중인 캐릭터</Text>
        <ScrollArea style={{ height: '300px' /* Adjust height as needed */ }} type="auto">
          <Stack gap="sm">
            {chatRoom?.characters?.map((char) => (
              <Paper key={char.id} p="xs" withBorder radius="sm">
                <Group justify="space-between">
                  {/* Character Info & Active Status */}
                  <Group gap="xs" style={{ flex: 1 }}>
                    <ThemeIcon
                      variant={chatRoom?.activeCharacterIds?.includes(char.id) ? 'filled' : 'light'}
                      color={chatRoom?.activeCharacterIds?.includes(char.id) ? 'teal' : 'gray'}
                      radius="xl"
                      size="sm"
                    >
                      {chatRoom?.activeCharacterIds?.includes(char.id) ? <IconUserCheck size={12} /> : <IconUserOff size={12} />}
                    </ThemeIcon>
                    <Avatar src={char.image} size="sm" radius="xl" />
                    <Text size="sm" style={{ flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{char.name}</Text>
                    {/* Add a badge for the next speaker */}
                    {chatRoom?.isGroupChat && chatRoom?.activeCharacterIds && chatRoom?.nextSpeakerIndex !== undefined && chatRoom.activeCharacterIds[chatRoom.nextSpeakerIndex] === char.id && (
                      <Badge size="xs" variant="light" color="blue">Next</Badge>
                    )}
                  </Group>
                  {/* Action Buttons */}
                  <Group gap="xs">
                    <Checkbox
                      checked={chatRoom?.activeCharacterIds?.includes(char.id)}
                      onChange={() => handleToggleCharacterActive(char.id)}
                      title={chatRoom?.activeCharacterIds?.includes(char.id) ? '대화 비활성화' : '대화 활성화'}
                      disabled={(chatRoom?.activeCharacterIds?.length ?? 0) <= 1 && chatRoom?.activeCharacterIds?.includes(char.id)} // Prevent disabling last active
                    />
                    <ActionIcon
                      variant="light"
                      color="red"
                      onClick={() => handleRemoveCharacter(char.id)}
                      title="채팅방에서 제거"
                      disabled={chatRoom?.characters && chatRoom.characters.length <= 1} // Prevent removing last character
                    >
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Paper>
            ))}
          </Stack>
        </ScrollArea>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose}>닫기</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export default ManageCharactersModal;