import { seedCharacters, createDefaultCharacter } from './character-utils';

/**
 * 데이터베이스 초기화 함수
 * 새 사용자 등록 시 기본 데이터를 생성하는 데 사용됩니다
 * 
 * @param userId - 사용자 ID
 * @param userName - 사용자 이름
 * @returns 생성된 캐릭터와 채팅방에 대한
 */
export const initializeUserData = async (userId: string, userName: string) => {
  try {
    console.log(`사용자 ${userName}(${userId})의 초기 데이터 생성 중...`);
    
    // 1. 기본 캐릭터 생성
    const defaultCharacterId = await createDefaultCharacter(userId);
    console.log(`기본 캐릭터 생성 완료: ${defaultCharacterId}`);
    
    // 2. 샘플 캐릭터 생성 (선택 사항)
    const sampleCharacterIds = await seedCharacters(userId);
    console.log(`${sampleCharacterIds.length}개의 샘플 캐릭터 생성 완료`);
    
    return {
      defaultCharacterId,
      sampleCharacterIds
    };
  } catch (error) {
    console.error('사용자 데이터 초기화 중 오류 발생:', error);
    throw error;
  }
};

/**
 * 전체 애플리케이션 데이터베이스 시드 함수
 * 개발/테스트 환경에서만 사용하는 것을 권장합니다
 * 
 * @param adminUserId - 관리자 사용자 ID
 * @param adminUserName - 관리자 사용자 이름
 */
export const seedDatabase = async (adminUserId: string) => {
  try {
    console.log('데이터베이스 시드 작업 시작...');
    
    // 1. 샘플 캐릭터 생성
    const characterIds = await seedCharacters(adminUserId);
    console.log(`${characterIds.length}개의 캐릭터가 생성되었습니다.`);
    
    // 2. 여기에 다른 컬렉션의 시드 로직 추가 가능
    // 예: 샘플 채팅방 생성 등
    
    console.log('데이터베이스 시드 작업 완료!');
    
    return {
      characterIds
    };
  } catch (error) {
    console.error('데이터베이스 시드 작업 중 오류 발생:', error);
    throw error;
  }
};