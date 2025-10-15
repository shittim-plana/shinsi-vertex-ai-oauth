import admin from 'firebase-admin'; // require -> import (default)
import { getFirestore } from 'firebase-admin/firestore'; // require -> import (named)

// 서비스 계정 키 파일 경로 (프로젝트 루트 기준)
// TODO: 실제 서비스 계정 키 파일 경로로 변경하세요. ('../../'는 이 파일의 위치 기준 상대 경로입니다)
// JSON import requires 'with { type: "json" }' attribute
import serviceAccount from '../../arona-mk-2-firebase-adminsdk-fbsvc-77389f5402.json' with { type: 'json' }; // Use 'with' instead of 'assert'

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
} catch (error) {
  // 이미 초기화된 경우 오류 무시
  if (error.code !== 'app/duplicate-app') {
    console.error('Firebase Admin SDK 초기화 오류:', error);
    process.exit(1); // 초기화 실패 시 프로세스 종료
  }
}

const db = getFirestore();

/**
 * 캐릭터별 채팅 메시지 수를 집계하여 Firestore 'characters' 컬렉션을 업데이트합니다.
 */
async function updateCharacterChatCounts() {
  console.log('대화 수 업데이트 배치를 시작합니다...'); // 로그 메시지 수정

  try {
    const chatRoomsSnapshot = await db.collection("chatRooms").get();
    const characterConversationCounts = {}; // 변수 이름 명확화 (선택 사항)

    console.log(`${chatRoomsSnapshot.docs.length}개의 채팅방을 조회합니다.`);

    // 모든 채팅방의 메시지 조회 Promise 배열 생성
    const messageFetchPromises = chatRoomsSnapshot.docs.map(async (chatRoomDoc) => {
      try {
        const messagesSnapshot = await db
          .collection("chatRooms")
          .doc(chatRoomDoc.id)
          .collection("messages")
          .where('isCharacter', '==', true) // 캐릭터가 보낸 메시지만 필터링
          .get();

        console.log(`채팅방 ${chatRoomDoc.id}: ${messagesSnapshot.docs.length}개의 캐릭터 메시지 조회 완료`);

        messagesSnapshot.docs.forEach((msgDoc) => {
          const data = msgDoc.data();
          const characterId = data.characterId;

          // characterId가 유효한 경우에만 집계
          if (characterId && typeof characterId === 'string' && characterId.trim() !== '') {
            // 변수 이름 변경 반영 (선택 사항)
            characterConversationCounts[characterId] = (characterConversationCounts[characterId] || 0) + 1;
          } else {
             // console.warn(`메시지 ${msgDoc.id} (채팅방 ${chatRoomDoc.id})에 유효한 characterId가 없습니다.`);
          }
        });
      } catch (error) {
        console.error(`채팅방 ${chatRoomDoc.id}의 메시지 조회 중 오류 발생:`, error);
        // 개별 채팅방 오류가 전체 배치에 영향을 주지 않도록 처리
      }
    });

    // 모든 메시지 조회 Promise가 완료될 때까지 대기
    await Promise.all(messageFetchPromises);

    console.log('캐릭터별 대화 수 집계 완료:', characterConversationCounts); // 로그 메시지 수정

    // Firestore 업데이트 (Batch 사용)
    const batch = db.batch();
    let updateCount = 0;

    // 변수 이름 변경 반영 (선택 사항)
    for (const characterId in characterConversationCounts) {
      // 객체 자체의 속성인지 확인
      if (Object.prototype.hasOwnProperty.call(characterConversationCounts, characterId)) {
        const count = characterConversationCounts[characterId]; // 새로 계산된 대화 수
        const characterRef = db.collection('characters').doc(characterId);

        try {
          const characterDoc = await characterRef.get();
          const existingCount = characterDoc.exists ? characterDoc.data()?.conversationCount || 0 : 0; // 기존 대화 수 가져오기 (없으면 0)

          // 새로 계산된 수가 기존 수보다 클 경우에만 업데이트
          if (count > existingCount) {
            // 필드 이름 변경: chatCount -> conversationCount
            batch.set(characterRef, { conversationCount: count }, { merge: true });
            updateCount++;
            // 로그 메시지 필드 이름 변경: chatCount -> conversationCount
            console.log(`캐릭터 ${characterId}의 conversationCount를 ${existingCount}에서 ${count}로 업데이트 준비`);
          } else {
            console.log(`캐릭터 ${characterId}의 conversationCount (${existingCount})가 계산된 값 (${count})보다 크거나 같으므로 업데이트를 건너<0xEB><0x9C><0x91>니다.`);
          }
        } catch (error) {
          console.error(`캐릭터 ${characterId} 문서 조회 또는 업데이트 준비 중 오류 발생:`, error);
        }
      }
    }

    // 업데이트할 내용이 있을 경우에만 batch commit 실행
    if (updateCount > 0) {
      await batch.commit();
      // 로그 메시지 수정
      console.log(`${updateCount}명의 캐릭터 대화 수를 성공적으로 업데이트했습니다.`);
    } else {
      console.log('업데이트할 캐릭터 대화 수가 없습니다.'); // 로그 메시지 수정
    }

  } catch (error) {
    console.error('배치 실행 중 심각한 오류 발생:', error);
  } finally {
    console.log('대화 수 업데이트 배치를 종료합니다.'); // 로그 메시지 수정
    // Firestore 연결은 앱 종료 시 자동으로 관리되므로 명시적으로 닫을 필요는 없습니다.
    // admin.app().delete(); // 필요 시 명시적 종료
  }
}

// 스크립트 실행
updateCharacterChatCounts();