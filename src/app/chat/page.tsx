'use client';

import React, { useState, useEffect, useMemo } from 'react'; // Added useMemo
import { Loader, Container, Title, Text, Grid, Card, Group, Avatar, Badge, Button, TextInput, Modal, Stack, MultiSelect, Checkbox, Box } from '@mantine/core'; // Added Loader
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { useRouter } from 'next/navigation';
import { useForm } from '@mantine/form';
import { IconSearch, IconPlus, IconMessageCircle, IconTrash, IconAlertCircle, IconUsers, IconDownload, IconBook } from '@tabler/icons-react'; // IconBook 추가
import { db, storage } from '@/firebase/config';
import { collection, query, orderBy, getDocs, Timestamp, where, doc, getDoc, writeBatch, documentId, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { useAuth } from '@/contexts/AuthContext';
import { v4 as uuidv4 } from 'uuid';
// import { searchCharactersByName } from '@/utils/character-utils'; // Removed old search util
import { usePublicCharacters } from '@/hooks/usePublicCharacters'; // Import hook for public characters
import { characterFromDoc } from '@/utils/firestoreUtils'; // Import utility function
import { filterActiveCharacters } from '@/utils/character-utils';
import { notifications } from '@mantine/notifications';
import { AppShell } from '@/components/layout/AppShell';
import type { Character } from '@/types/character';
import { ChatRoom } from '@/types/chat';
import { LorebookEntry } from '@/types/lorebook'; // LorebookEntry 임포트
import { useAccessibleLorebooks } from '@/hooks/useAccessibleLorebooks'; // Hook 임포트

// MultiSelect 데이터 형식 정의 (로어북용)
interface LorebookSelectItem {
  value: string; // Lorebook ID
  label: string; // Lorebook Title
}

export default function ChatListPage() {
  // --- State Declarations ---
  const [chatRooms, setChatRooms] = useState<ChatRoom[]>([]);
  const [filteredRooms, setFilteredRooms] = useState<ChatRoom[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [opened, { open, close }] = useDisclosure(false);
  const [imageUpload, setImageUpload] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  // State for modal character search
  const [charSearchTerm, setCharSearchTerm] = useState('');
  const [debouncedCharSearchTerm] = useDebouncedValue(charSearchTerm, 300); // Keep debounced search term
  // Remove states related to old search and detail fetching
  const [userCharacters, setUserCharacters] = useState<Character[]>([]); // State for user's own characters
  const [loadingUserCharacters, setLoadingUserCharacters] = useState(true); // Loading state for user characters
  // State for room selection/deletion
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [isDeleteConfirmModalOpen, setIsDeleteConfirmModalOpen] = useState(false);
  const [includeUserMessages, setIncludeUserMessages] = useState(true); // 사용자 메시지 포함 여부
  const [exportLoading, setExportLoading] = useState(false);
  const [openedExport, { open: openExportModal, close: closeExportModal }] = useDisclosure(false);
  // 로어북 관련 상태는 hook에서 가져옴

  // --- Hook Declarations ---
  const { user, uid } = useAuth(); // uid 추가
  const router = useRouter();
  const { publicCharacters, loading: loadingPublicCharacters } = usePublicCharacters(); // Use public characters hook, Removed publicCharactersError
  // useAccessibleLorebooks hook 사용
  const { lorebookEntries, loading: loadingLorebooks, error: lorebookError } = useAccessibleLorebooks(uid);
  const form = useForm({ // Form declaration
    initialValues: {
      name: '',
      description: '',
      tags: '',
      isNSFW: false,
      characterIds: [] as string[],
      lorebookIds: [] as string[], // lorebookIds 필드 추가
    },
    validate: {
      name: (value) => (value.length > 0 ? null : '채팅방 이름을 입력해주세요'),
      description: (value) => (value.length > 0 ? null : '설명을 입력해주세요'),
      characterIds: (value) => (value.length >= 2 ? null : '최소 두 명 이상의 캐릭터를 선택해주세요'),
    },
  });

  // --- useEffect Hooks ---

  // Redirect if not logged in
  useEffect(() => {
    if (!user) {
      router.push('/login');
    }
  }, [user, router]);

  // Fetch user's characters when modal might be opened or user changes
  useEffect(() => {
    const fetchUserCharacters = async () => {
      if (!user?.uid) {
        setLoadingUserCharacters(false);
        return;
      }
      setLoadingUserCharacters(true);
      try {
        const charactersRef = collection(db, 'characters');
        const q = query(
          charactersRef,
          where('creatorId', '==', user.uid),
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
        console.error("Error fetching user characters for modal:", error);
      } finally {
        setLoadingUserCharacters(false);
      }
    };
    fetchUserCharacters();
  }, [user?.uid]);

  // 로어북 로딩 useEffect 제거 (hook이 처리)


  // Fetch chat rooms
  useEffect(() => {
    const fetchChatRooms = async () => {
      if (!user) {
        setChatRooms([]);
        setFilteredRooms([]);
        setLoading(false); // Ensure loading stops if no user
        return;
      }

      setLoading(true);
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        const userData = userDoc.data();
        const recentChatIds = userData?.recentChats || [];

        const creatorQuery = query(
          collection(db, 'chatRooms'),
          where('creatorId', '==', user.uid),
          orderBy('lastUpdated', 'desc')
        );

        const creatorSnapshot = await getDocs(creatorQuery);
        const roomsData: ChatRoom[] = [];
        const processedIds = new Set<string>();

        creatorSnapshot.forEach((doc) => {
          const data = doc.data();
          roomsData.push({
            id: doc.id,
            name: data.name,
            description: data.description,
            creatorId: data.creatorId,
            creatorName: data.creatorName,
            image: data.image,
            members: data.members || 0,
            lastUpdated: data.lastUpdated?.toDate(), // Keep as Date | undefined
            tags: data.tags || [],
            isNSFW: data.isNSFW || false,
            isGroupChat: data.isGroupChat || false, // Include isGroupChat
          });
          processedIds.add(doc.id);
        });

        if (recentChatIds.length > 0) {
          const additionalIds = recentChatIds.filter((id: string) => !processedIds.has(id));
          if (additionalIds.length > 0) {
            for (let i = 0; i < additionalIds.length; i += 10) {
              const batch = additionalIds.slice(i, i + 10);
              const recentQuery = query(
                collection(db, 'chatRooms'),
                where(documentId(), 'in', batch)
              );
              const recentSnapshot = await getDocs(recentQuery);
              recentSnapshot.forEach((doc) => {
                if (processedIds.has(doc.id)) return;
                const data = doc.data();
                // 보안: 생성자가 현재 사용자와 일치하지 않는 방은 제외
                if (data?.creatorId !== user.uid) return;

                roomsData.push({
                  id: doc.id,
                  name: data.name,
                  description: data.description,
                  creatorId: data.creatorId,
                  creatorName: data.creatorName,
                  image: data.image,
                  members: data.members || 0,
                  lastUpdated: data.lastUpdated?.toDate(),
                  tags: data.tags || [],
                  isNSFW: data.isNSFW || false,
                  isGroupChat: data.isGroupChat || false,
                });
                processedIds.add(doc.id);
              });
            }
          }
        }

        roomsData.sort((a, b) => (b.lastUpdated?.getTime() ?? 0) - (a.lastUpdated?.getTime() ?? 0));
        // 최종 안전 필터: 생성자 본인인 채팅방만 노출
        const ownedRooms = roomsData.filter(r => r.creatorId === user.uid);
        setChatRooms(ownedRooms);
        setFilteredRooms(ownedRooms);
      } catch (error) {
        console.error('채팅방 로딩 에러:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchChatRooms();
  }, [user]);

  // Filter chat rooms based on searchTerm
  useEffect(() => {
    if (searchTerm.trim() === '') {
      setFilteredRooms(chatRooms);
    } else {
      const filtered = chatRooms.filter(
        (room) =>
          room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          room?.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (room.tags ?? []).some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      setFilteredRooms(filtered);
    }
  }, [searchTerm, chatRooms]);

  // --- useMemo Hook ---
  // Prepare data for the modal's MultiSelect
  const modalMultiSelectData = useMemo(() => {
    // Group 1: User's private characters
    const myPrivateChars = userCharacters
      .filter(char => !char.isPublic)
      .map(char => ({ value: char.id, label: char.name }));

    // Group 2: All public characters
    const publicCharsMap = new Map(publicCharacters.map(char => [char.id, char]));
    const publicCharItems = Array.from(publicCharsMap.values())
      .map(char => ({
        value: char.id,
        label: char.creatorId === user?.uid ? `${char.name} (내 공개 캐릭터)` : `${char.name} (공개)`
      }));

    const baseData = [
      { group: '내 비공개 캐릭터', items: myPrivateChars },
      { group: '공개 캐릭터', items: publicCharItems }
    ].filter(group => group.items.length > 0);

    // Apply client-side search filtering based on debouncedCharSearchTerm
    if (!debouncedCharSearchTerm.trim()) {
      return baseData;
    }
    const searchTermLower = debouncedCharSearchTerm.toLowerCase();
    return baseData.map(group => ({
      ...group,
      items: group.items.filter(item => item.label.toLowerCase().includes(searchTermLower))
    })).filter(group => group.items.length > 0);

  }, [userCharacters, publicCharacters, debouncedCharSearchTerm, user?.uid]);

  // 로어북 데이터를 MultiSelect 형식으로 변환 (useMemo 사용)
  const lorebookOptions = useMemo(() => {
    return lorebookEntries.map((entry: LorebookEntry) => ({
      value: entry.id,
      label: entry.title,
    }));
  }, [lorebookEntries]);

  // --- Helper Functions ---

 // 정규 표현식 특수 문자 이스케이프 함수
 const escapeRegExp = (string: string) => {
   return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $&는 일치한 전체 문자열을 의미
 };

 // 파일 다운로드 헬퍼 함수
 const downloadTxtFile = (filename: string, text: string) => {
   const element = document.createElement('a');
   const file = new Blob([text], { type: 'text/plain;charset=utf-8' });
   element.href = URL.createObjectURL(file);
   element.download = `${filename}.txt`;
   document.body.appendChild(element); // Required for this to work in FireFox
   element.click();
   document.body.removeChild(element);
 };

 // 선택된 채팅방 내보내기 함수
 const handleExportSelectedRooms = async () => {
   if (selectedRoomIds.length === 0 || !user) return;

   setExportLoading(true);
   try {
     for (const roomId of selectedRoomIds) {
       const room = chatRooms.find(r => r.id === roomId);
       if (!room) continue;

       // Firestore에서 메시지 가져오기 (timestamp 기준으로 시간순 정렬)
       const messagesRef = collection(db, 'chatRooms', roomId, 'messages');
       const q = query(messagesRef, orderBy('timestamp', 'asc'));
       const messagesSnapshot = await getDocs(q);

       let chatContent = `채팅방: ${room.name}\n`;
       chatContent += `설명: ${room.description}\n`;
       // 참여자 정보는 characterIds를 기반으로 가져와야 하지만, 여기서는 생략하거나 ID만 표시
       chatContent += `캐릭터 ID: ${room.characterIds?.join(', ') || '정보 없음'}\n`;
       chatContent += `생성자: ${room.creatorName}\n`;
       chatContent += `--------------------\n\n`;

       messagesSnapshot.forEach((doc) => {
         const message = doc.data();
         const senderName = message.senderName || (message.senderId === user.uid ? user.displayName || '나' : `캐릭터(${message.senderId.substring(0, 5)})`); // 임시 이름
         const messageText = message.text || '';

         // 피드백 반영: 동적으로 정규 표현식 생성 및 패턴 제거 (추가 패턴 포함)
         const escapedSenderName = escapeRegExp(senderName);
         // 피드백 반영: 소설도우미 하드코딩 제거
         // 피드백 반영: Response 패턴만 제거하도록 수정 (정확한 패턴)
         const pattern = `${escapedSenderName}'s (?:존댓말|반말) Response`;
         const regex = new RegExp(pattern);
         let cleanedText = messageText.replace(regex, '');
         cleanedText = cleanedText.replace(/:/g, '').trim(); // 줄바꿈 제거 및 공백 정리

         // 사용자 메시지 포함 여부 확인
         if (message.senderId === user.uid && !includeUserMessages) {
           // 사용자 메시지 미포함 시 건너뛰기
         } else {
           // 제거된 텍스트 사용
           chatContent += `${cleanedText}\n`;
         }
       });

       // 파일 다운로드 (채팅방 이름으로 파일명 지정)
       const filename = room.name.replace(/[^a-z0-9ㄱ-ㅎㅏ-ㅣ가-힣]/gi, '_'); // 파일명 유효 문자 처리
       downloadTxtFile(filename || `chat_${roomId}`, chatContent);

       // 여러 파일 동시 다운로드 시 브라우저 제한이 있을 수 있으므로 약간의 딜레이 추가 (선택 사항)
       await new Promise(resolve => setTimeout(resolve, 100));
     }

     notifications.show({
       title: '내보내기 완료',
       message: `${selectedRoomIds.length}개의 채팅방 내용이 txt 파일로 저장되었습니다.`,
       color: 'green',
       icon: <IconDownload size={16} />,
     });

   } catch (error) {
     console.error('Error exporting chat rooms:', error);
     notifications.show({
       title: '내보내기 실패',
       message: '채팅 내용을 내보내는 중 오류가 발생했습니다.',
       color: 'red',
     });
   } finally {
     setExportLoading(false);
     closeExportModal();
     setSelectedRoomIds([]); // 내보내기 후 선택 해제
   }
 };
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setImageUpload(file);
      const fileReader = new FileReader();
      fileReader.onload = () => {
        setImagePreview(fileReader.result as string);
      };
      fileReader.readAsDataURL(file);
    }
  };

  const createChatRoom = async (values: typeof form.values) => {
    if (!user) return;
    setUploadLoading(true);
    try {
      let imageUrl = '';
      if (imageUpload) {
        const storageRef = ref(storage, `chatRooms/${uuidv4()}`);
        await uploadBytes(storageRef, imageUpload);
        imageUrl = await getDownloadURL(storageRef);
      }
      const tagsArray = values.tags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
      const isGroupChat = values.characterIds.length > 1; // Should always be true based on validation

      const roomId = uuidv4();
      await setDoc(doc(db, 'chatRooms', roomId), {
        name: values.name,
        description: values.description,
        creatorId: user.uid,
        creatorName: user.displayName,
        image: imageUrl,
        members: 1,
        createdAt: Timestamp.now(),
        lastUpdated: Timestamp.now(),
        tags: tagsArray,
        isNSFW: values.isNSFW,
        characterIds: values.characterIds,
        isGroupChat: isGroupChat,
        activeCharacterIds: values.characterIds,
        nextSpeakerIndex: 0,
        lorebookIds: values.lorebookIds || [], // lorebookIds 추가
        // messages: [], // messages 필드는 서브컬렉션으로 관리되므로 제거 가능
        lastMessage: '',
      });

      console.log("Skipping initial message generation during room creation.");
      router.push(`/chat/${roomId}`);
    } catch (error) {
      console.error('채팅방 생성 에러:', error);
      notifications.show({ title: '생성 실패', message: '채팅방 생성 중 오류 발생', color: 'red' });
    } finally {
      setUploadLoading(false);
      close();
      form.reset(); // Reset form after closing modal
      setImagePreview(null);
      setImageUpload(null);
      setCharSearchTerm(''); // Reset search term
    }
  };

  const getDaysSinceLastUpdate = (date: Date | undefined) => { // Allow undefined
    if (!date) return '-'; // Return default if date is undefined
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    return `${diffDays}d`;
  };

  const handleDeleteSelectedRooms = async () => {
    if (selectedRoomIds.length === 0 || !user) {
      notifications.show({ title: '오류', message: '삭제할 채팅방이 선택되지 않았거나 사용자 정보가 없습니다.', color: 'red' });
      return;
    }
    const batch = writeBatch(db);
    selectedRoomIds.forEach((roomId) => {
      const roomDocRef = doc(db, 'chatRooms', roomId);
      batch.delete(roomDocRef);
    });
    try {
      await batch.commit();
      notifications.show({ title: '삭제 완료', message: `${selectedRoomIds.length}개의 채팅방이 성공적으로 삭제되었습니다.`, color: 'green' });
      const remainingRooms = chatRooms.filter(room => !selectedRoomIds.includes(room.id));
      setChatRooms(remainingRooms);
      setFilteredRooms(remainingRooms.filter(
        (room) =>
          room.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          room?.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (room.tags ?? []).some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase()))
      ));
      setSelectedRoomIds([]);
    } catch (error) {
      console.error('Error deleting selected chat rooms:', error);
      notifications.show({ title: '삭제 실패', message: '선택된 채팅방을 삭제하는 중 오류가 발생했습니다.', color: 'red' });
    } finally {
      setIsDeleteConfirmModalOpen(false);
    }
  };

  // --- Early Return / Loading ---
  if (!user) {
    return <Text ta="center" py="xl">로그인이 필요합니다...</Text>;
  }

  // --- Return Statement ---
  return (
    <AppShell>
      <Container size="lg" px="md" py="xl">
        <Group justify="space-between" mb="md">
          <Title order={2}>채팅방</Title>
          <Group> {/* 버튼 그룹 */}
           {selectedRoomIds.length > 0 && (
             <>
               <Button
                 variant="outline"
                 leftSection={<IconDownload size={16} />}
                 onClick={openExportModal} // 내보내기 모달 열기
                 disabled={exportLoading}
               >
                 선택된 채팅방 내보내기 ({selectedRoomIds.length})
               </Button>
               <Button
                 color="red"
                 leftSection={<IconTrash size={16} />}
                 onClick={() => setIsDeleteConfirmModalOpen(true)}
                 disabled={exportLoading} // 내보내기 중에는 삭제 비활성화
               >
                 선택된 채팅방 삭제 ({selectedRoomIds.length})
               </Button>
             </>
           )}
           {selectedRoomIds.length === 0 && (
             <Button leftSection={<IconPlus size={16} />} onClick={open}>
               단체 채팅방 만들기
             </Button>
           )}
         </Group>
        </Group>

        <TextInput
          placeholder="채팅방 검색..."
          mb="lg"
          leftSection={<IconSearch size={16} />}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        {filteredRooms.length > 0 && (
          <Group mb="md">
            <Checkbox
              label="전체 선택/해제"
              checked={selectedRoomIds.length > 0 && filteredRooms.every((room) => selectedRoomIds.includes(room.id))}
              indeterminate={selectedRoomIds.length > 0 && !filteredRooms.every((room) => selectedRoomIds.includes(room.id))}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setSelectedRoomIds(checked ? filteredRooms.map((room) => room.id) : []);
              }}
            />
          </Group>
        )}

        {loading ? (
          <Text ta="center" py="xl">로딩 중...</Text>
        ) : filteredRooms.length > 0 ? (
          <Grid>
            {filteredRooms.map((room) => (
              <Grid.Col key={room.id} span={{ base: 12, sm: 6, lg: 4 }}>
                <Card shadow="sm" padding="lg" radius="md" withBorder style={{ height: '100%', position: 'relative' }}>
                  <Checkbox
                    checked={selectedRoomIds.includes(room.id)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelectedRoomIds((prev) => checked ? [...prev, room.id] : prev.filter((id) => id !== room.id));
                    }}
                    style={{ position: 'absolute', top: 10, right: 10, zIndex: 1 }}
                    aria-label={`Select chat room ${room.name}`}
                  />
                  <Box onClick={() => router.push(`/chat/${room.id}`)} style={{ cursor: 'pointer' }}>
                    <Group justify="space-between" mb="xs">
                      <Group>
                        <Avatar src={room.image} size="md" radius="xl" color="purple">
                          {room.isGroupChat ? <IconUsers size={24} /> : <IconMessageCircle size={24} />}
                        </Avatar>
                        <div>
                          <Text fw={700}>{room.name}</Text>
                          <Text size="xs" c="dimmed">by {room.creatorName}</Text>
                        </div>
                      </Group>
                      <Text size="xs" c="dimmed">
                        {getDaysSinceLastUpdate(room.lastUpdated)}
                      </Text>
                    </Group>
                    <Text size="sm" lineClamp={2} mb="md">{room.description}</Text>
                    <Group justify="space-between" mt="auto">
                      <Text size="xs" c="dimmed"></Text>
                      {room.isNSFW && (<Badge color="red" variant="light">NSFW</Badge>)}
                    </Group>
                  </Box>
                </Card>
              </Grid.Col>
            ))}
          </Grid>
        ) : (
          <Text ta="center" py="xl" c="dimmed">검색 결과가 없습니다</Text>
        )}

        {/* Create Chat Room Modal */}
        <Modal opened={opened} onClose={() => { close(); form.reset(); setImagePreview(null); setImageUpload(null); setCharSearchTerm(''); }} title="단체 채팅방 만들기" size="md">
          <form onSubmit={form.onSubmit(createChatRoom)}>
            <Stack>
              <TextInput label="채팅방 이름" placeholder="채팅방 이름 입력" required {...form.getInputProps('name')} />
              <TextInput label="설명" placeholder="채팅방에 대한 간단한 설명" required {...form.getInputProps('description')} />
              <TextInput label="태그" placeholder="쉼표로 구분 (예: 판타지, 모험, 로맨스)" {...form.getInputProps('tags')} />
              <MultiSelect
                label="캐릭터 선택"
                placeholder="채팅할 캐릭터 이름 검색 (2명 이상)"
                data={modalMultiSelectData} // Use new memoized data
                required
                searchable
                searchValue={charSearchTerm}
                onSearchChange={setCharSearchTerm}
                nothingFoundMessage={charSearchTerm ? "검색 결과가 없습니다." : "선택 가능한 캐릭터가 없습니다."}
                clearable
                disabled={loadingUserCharacters || loadingPublicCharacters} // Disable while loading
                rightSection={loadingUserCharacters || loadingPublicCharacters ? <Loader size="xs" /> : null}
               {...form.getInputProps('characterIds')}
             />
             {/* Lorebook Selection */}
             <MultiSelect
               label="로어북 연결 (선택사항)"
               placeholder={loadingLorebooks ? "로어북 로딩 중..." : "연결할 로어북 선택"}
               data={lorebookOptions} // 변환된 데이터 사용
               searchable
               clearable
               disabled={loadingLorebooks || !!lorebookError} // 로딩 중이거나 에러 발생 시 비활성화
               leftSection={<IconBook size={14} />}
               description="채팅 시 AI가 참고할 로어북을 선택합니다. (자신의 로어북 + 공개 로어북)"
               {...form.getInputProps('lorebookIds')}
             />
             {/* 로어북 로딩 에러 표시 */}
             {lorebookError && !loadingLorebooks && (
                <Text c="red" size="xs">로어북 로딩 중 오류 발생: {lorebookError}</Text>
             )}
             <Group>
               <input type="file" id="imageUpload" accept="image/*" style={{ display: 'none' }} onChange={handleImageChange} />
                <Button component="label" htmlFor="imageUpload" variant="light">이미지 업로드</Button>
                {imagePreview && (<Avatar src={imagePreview} size="lg" radius="md" />)}
              </Group>
              <Group>
                <input type="checkbox" id="isNSFW" checked={form.values.isNSFW} onChange={(e) => form.setFieldValue('isNSFW', e.target.checked)} />
                <label htmlFor="isNSFW"><Text size="sm">성인 콘텐츠 (NSFW)</Text></label>
              </Group>
              <Button type="submit" loading={uploadLoading}>채팅방 생성</Button>
            </Stack>
          </form>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal
          opened={isDeleteConfirmModalOpen}
          onClose={() => setIsDeleteConfirmModalOpen(false)}
          title={<Group gap="xs"><IconAlertCircle size={20} color="red" /><Text fw={700}>선택된 채팅방 삭제 확인</Text></Group>}
          centered
        >
          <Stack>
            <Text>정말로 선택된 {selectedRoomIds.length}개의 채팅방을 삭제하시겠습니까?</Text>
            <Text c="dimmed" size="sm">이 작업은 되돌릴 수 없으며, 모든 메시지가 영구적으로 삭제됩니다.</Text>
            <Group justify="flex-end" mt="md">
              <Button variant="outline" onClick={() => setIsDeleteConfirmModalOpen(false)}>취소</Button>
              <Button color="red" onClick={handleDeleteSelectedRooms}>삭제</Button>
            </Group>
          </Stack>
        </Modal>
      </Container>

       {/* Export Confirmation Modal */}
       <Modal
         opened={openedExport}
         onClose={closeExportModal}
         title="채팅 내용 내보내기"
         centered
       >
         <Stack>
           <Text>선택된 {selectedRoomIds.length}개의 채팅방 내용을 txt 파일로 내보냅니다.</Text>
           <Checkbox
             label="내 메시지 포함하기"
             checked={includeUserMessages}
             onChange={(event) => setIncludeUserMessages(event.currentTarget.checked)}
           />
           <Group justify="flex-end" mt="md">
             <Button variant="default" onClick={closeExportModal} disabled={exportLoading}>취소</Button>
             <Button
               leftSection={<IconDownload size={16} />}
               onClick={handleExportSelectedRooms}
               loading={exportLoading}
             >
               내보내기
             </Button>
           </Group>
         </Stack>
       </Modal>

    </AppShell>
  );
}