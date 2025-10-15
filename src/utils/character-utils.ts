import { db, storage } from '@/firebase/config';
import { collection, doc, setDoc, getDocs, query, where, deleteDoc, orderBy, limit } from 'firebase/firestore'; // Added orderBy, limit
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { v4 as uuidv4 } from 'uuid';
import { Character } from '@/types/chat'; // Import central Character type
import dayjs from 'dayjs';

// Common UI defensive filter: remove soft-deleted characters across lists
// Treats undefined isDeleted as active (false) for defensive clarity.
export function filterActiveCharacters<T>(characters: T[]): T[] {
  return ((characters || []) as any[]).filter((c: any) => c?.isDeleted !== true) as T[];
}
// Removed local Character interface definition. Using the one from @/types/chat
// Sample character data for seeding
// Adjusted Omit type and added missing fields based on Character from @/types/chat
const sampleCharacters: Omit<Character, 'id' | 'creatorId' | 'createdAt'>[] = [
  {
    name: '아리아',
    description: '친절한 AI 어시스턴트',
    detail: '사용자를 도와주는 것을 좋아하는 친절한 AI 어시스턴트입니다. 다양한 주제에 대해 대화할 수 있으며, 항상 도움이 되는 답변을 제공하려고 노력합니다.',
    firstMessage: '안녕하세요! 오늘은 제가 어떻게 도와드릴까요?',
    image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Farona.png?alt=media',
    isPublic: true,
    isNSFW: false,
    tags: ['AI', '어시스턴트', '친근한', '도움이 되는'],
    isBanmal: false,
    conversationCount: 0,
    likesCount: 0,
    likedBy: []
  },
  {
    name: '루나',
    description: '활발한 AI 도우미',
    detail: '기발한 아이디어와 넘치는 에너지를 가진 활발한 AI 도우미입니다. 창의적인 해결책을 제시하며, 때로는 예상치 못한 접근법을 사용하지만 항상 사용자를 위한 마음을 가지고 있습니다.',
    firstMessage: '어라? 새로운 사용자인가요? 반가워요! 저는 루나, 여러분의 AI 도우미예요!',
    image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Fyuuka.png?alt=media',
    isPublic: true,
    isNSFW: false,
    tags: ['AI', '활발한', '창의적인', '에너지'],
    isBanmal: false,
    conversationCount: 0,
    likesCount: 0,
    likedBy: []
  },
  {
    name: '미카',
    description: '친절한 AI 도우미',
    detail: '이용자의 질문에 항상 친절하게 답변해주는 AI 도우미입니다. 다양한 주제에 대한 지식을 갖추고 있으며, 대화를 통해 도움을 제공합니다.',
    firstMessage: '안녕하세요! 저는 미카예요. 무엇을 도와드릴까요?',
    isPublic: true,
    isNSFW: false,
    tags: ['AI', '도우미', '친절한'],
    isBanmal: false,
    conversationCount: 0,
    likesCount: 0,
    likedBy: []
  },
  {
    name: '하루',
    description: '게임을 좋아하는 고양이',
    detail: '비디오 게임을 좋아하는 호기심 많은 고양이입니다. 특히 RPG 게임에 관심이 많고, 게임에 대한 이야기를 나누는 것을 좋아합니다.',
    firstMessage: '냥! 오늘은 어떤 게임 이야기를 할까요?',
    image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Fcat.png?alt=media',
    isPublic: true,
    isNSFW: false,
    tags: ['고양이', '게임', '귀여운'],
    isBanmal: true, // 고양이니까 반말?
    conversationCount: 0,
    likesCount: 0,
    likedBy: []
  },
  {
    name: '교수',
    description: '역사학 교수',
    detail: '역사학을 전공한 대학 교수로, 특히 세계사에 관한 깊은 지식을 가지고 있습니다. 역사적 사건과 인물에 관한 흥미로운 이야기를 들려주는 것을 좋아합니다.',
    firstMessage: '안녕하세요! 오늘은 어떤 역사적 이야기가 궁금하신가요?',
    isPublic: true,
    isNSFW: false,
    tags: ['역사', '교육', '교수'],
    isBanmal: false,
    conversationCount: 0,
    likesCount: 0,
    likedBy: []
  }
];

/**
 * 캐릭터 데이터베이스를 초기화(시드)하는 함수
 * @param userId - 캐릭터 생성자 ID
 * @param _userName - 캐릭터 생성자 이름 (현재 Character 타입에 미사용)
 * @returns 생성된 캐릭터 ID 배열
 */
export const seedCharacters = async (userId: string): Promise<string[]> => { // Mark userName as unused
  try {
    const characterIds: string[] = [];
    const charactersRef = collection(db, 'characters');

    // 기존에 이 사용자가 생성한 샘플 캐릭터 체크
    const existingQuery = query(
      charactersRef,
      where('creatorId', '==', userId),
      where('tags', 'array-contains', 'sample')
    );
    
    const existingDocs = await getDocs(existingQuery);
    
    // 기존 샘플 캐릭터 삭제 (덮어쓰기)
    const deletePromises: Promise<void>[] = [];
    existingDocs.forEach((doc) => {
      deletePromises.push(deleteDoc(doc.ref));
    });
    
    if (deletePromises.length > 0) {
      await Promise.all(deletePromises);
      console.log(`${deletePromises.length}개의 기존 샘플 캐릭터가 삭제되었습니다.`);
    }

    // 새 샘플 캐릭터 생성
    for (const sampleChar of sampleCharacters) {
      const characterId = uuidv4();
      
      // 각 샘플 캐릭터에 태그 추가
      const tags = [...(sampleChar.tags ?? []), 'sample']; // Handle potentially undefined tags
      
      const characterData: Omit<Character, 'id'> = {
        ...sampleChar,
        creatorId: userId,
        // creatorName: userName, // Not in Character type from @/types/chat
        tags,
        createdAt: dayjs().toDate(), // Use dayjs for current date
        // lastUpdated: serverTimestamp(), // Not in Character type from @/types/chat
        // Add missing required fields from Character type
        isBanmal: sampleChar.isBanmal,
        conversationCount: sampleChar.conversationCount,
        likesCount: sampleChar.likesCount,
        likedBy: sampleChar.likedBy,
      };
      
      // Firestore에 저장
      await setDoc(doc(charactersRef, characterId), characterData);
      characterIds.push(characterId);
    }
    
    console.log(`${characterIds.length}개의 샘플 캐릭터가 성공적으로 생성되었습니다.`);
    return characterIds;
  } catch (error) {
    console.error('캐릭터 시드 생성 중 오류 발생:', error);
    throw error;
  }
};

/**
 * 단일 커스텀 캐릭터를 생성하는 함수
 * @param character - 캐릭터 데이터
 * @param imageFile - 이미지 파일 (선택 사항)
 * @returns 생성된 캐릭터 ID
 */
export const createCharacter = async (
  character: Omit<Character, 'id' | 'createdAt'>,
  imageFile?: File
): Promise<string> => {
  try {
    const characterId = uuidv4();
    let imageUrl = '';
    
    // 이미지 업로드 (있는 경우)
    if (imageFile) {
      const storageRef = ref(storage, `characters/${characterId}`);
      const uploadTask = uploadBytesResumable(storageRef, imageFile);
      
      // 업로드 완료 대기
      await new Promise<void>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => {
            // 업로드 진행 상황 (필요시 여기에 로직 추가)
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log(`업로드 진행률: ${progress}%`);
          },
          (error) => {
            // 에러 처리
            reject(error);
          },
          () => {
            // 업로드 완료
            resolve();
          }
        );
      });
      
      // 이미지 URL 가져오기
      imageUrl = await getDownloadURL(storageRef);
    }
    
    // 캐릭터 데이터 준비
    const characterData: Omit<Character, 'id'> = {
      ...character,
      image: imageUrl || character.image || '',
      createdAt: dayjs().toDate(),
      // lastUpdated: serverTimestamp(), // Not in Character type from @/types/chat
    };
    
    // Firestore에 저장
    await setDoc(doc(collection(db, 'characters'), characterId), characterData);
    return characterId;
  } catch (error) {
    console.error('캐릭터 생성 중 오류 발생:', error);
    throw error;
  }
};

/**
 * 기본 캐릭터 생성 함수 (신규 사용자를 위한)
 * @param userId - 사용자 ID
 * @param _userName - 사용자 이름 (현재 Character 타입에 미사용)
 * @returns 생성된 기본 캐릭터 ID
 */
export const createDefaultCharacter = async (userId: string): Promise<string> => { // Mark userName as unused
  try {
    const defaultCharacter: Omit<Character, 'id' | 'createdAt' | 'image'> = {
      name: '아리아',
      description: '친절한 AI 어시스턴트',
      detail: '사용자를 도와주는 것을 좋아하는 친절한 AI 어시스턴트입니다. 다양한 주제에 대해 대화할 수 있으며, 항상 도움이 되는 답변을 제공하려고 노력합니다.',
      firstMessage: '안녕하세요! 오늘은 제가 어떻게 도와드릴까요?',
      creatorId: userId,
      // creatorName: userName, // Not in Character type from @/types/chat
      isPublic: false, // 기본 캐릭터는 비공개로 설정
      isNSFW: false,
      tags: ['기본', 'AI', '어시스턴트'],
      // Add missing required fields from Character type
      isBanmal: false,
      conversationCount: 0,
      likesCount: 0,
      likedBy: []
    };
    
    // 이미지 URL은 고정 값 사용 (Firebase Storage에 미리 업로드된 이미지)
    const imageUrl = 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Farona.png?alt=media';
    
    const characterId = uuidv4();
    const characterData: Omit<Character, 'id'> = {
      ...defaultCharacter,
      image: imageUrl,
      createdAt: dayjs().toDate(),
      // lastUpdated: serverTimestamp(), // Not in Character type from @/types/chat
    };
    
    await setDoc(doc(collection(db, 'characters'), characterId), characterData);
    return characterId;
  } catch (error) {
    console.error('기본 캐릭터 생성 중 오류 발생:', error);
    throw error;
  }
};

/**
 * 이름으로 공개된 캐릭터 및 사용자의 비공개 캐릭터를 검색하는 함수 (Firestore prefix search 사용)
 * @param searchTerm - 검색어
 * @param userId - 현재 사용자 ID (비공개 캐릭터 검색용)
 * @param limitCount - 반환할 최대 결과 수 (기본값 20)
 * @returns 검색된 캐릭터 배열
 */
export const searchCharactersByName = async (searchTerm: string, userId: string, limitCount: number = 20): Promise<Character[]> => {
  if (!searchTerm.trim()) {
    return []; // 검색어가 없으면 빈 배열 반환
  }
  const charactersRef = collection(db, 'characters');
  const nameQuery = [
    where('name', '>=', searchTerm),
    where('name', '<=', searchTerm + '\uf8ff')
  ];

  // 쿼리 1: 공개 캐릭터 검색
  const publicQuery = query(
    charactersRef,
    ...nameQuery,
    where('isPublic', '==', true),
    where('isDeleted', '==', false),
    orderBy('name'),
    limit(limitCount)
  );

  // 쿼리 2: 사용자의 비공개 캐릭터 검색
  const privateQuery = query(
    charactersRef,
    ...nameQuery,
    where('creatorId', '==', userId),
    where('isPublic', '==', false),
    where('isDeleted', '==', false),
    orderBy('name'),
    limit(limitCount) // 각 쿼리별 제한 적용
  );

  try {
    // 두 쿼리 병렬 실행
    const [publicSnapshot, privateSnapshot] = await Promise.all([
      getDocs(publicQuery),
      getDocs(privateQuery)
    ]);

    const charactersMap = new Map<string, Character>();

    // 결과 처리 함수
    const processSnapshot = (snapshot: typeof publicSnapshot) => {
      snapshot.docs.forEach(doc => {
        if (!charactersMap.has(doc.id)) {
          charactersMap.set(doc.id, {
            id: doc.id,
            ...doc.data(),
          } as Character);
        }
      });
    };

    processSnapshot(publicSnapshot);
    processSnapshot(privateSnapshot);

    // Map의 값들을 배열로 변환하여 반환 (중복 제거됨)
    // 필요하다면 여기서 추가 정렬 가능
    const combinedCharacters = filterActiveCharacters(Array.from(charactersMap.values()));
    // 최종 결과 수 제한 (limitCount보다 많을 수 있으므로)
    return combinedCharacters.slice(0, limitCount);
  } catch (error) {
    console.error("Error searching characters by name:", error);
    return []; // 오류 발생 시 빈 배열 반환
  }
};