// import * as admin from 'firebase-admin';
// import { FieldValue } from 'firebase-admin/firestore';

// // 중요: 서비스 계정 키 파일 경로를 설정해야 합니다.
// // Firebase 콘솔에서 생성할 수 있습니다. (https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk)
// // 예: const serviceAccount = require('../../../serviceAccountKey.json');
// import serviceAccount from '../../arona-mk-2-firebase-adminsdk-fbsvc-77389f5402.json';

// try {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount as admin.ServiceAccount)
//   });
// } catch (error: unknown) {
//   if (error instanceof Error && (error as any).code !== 'app/duplicate-app') {
//     console.error('Firebase Admin initialization error:', error);
//     process.exit(1);
//   } else if (error instanceof Error && (error as any).code === 'app/duplicate-app') {
//     console.log('Firebase Admin already initialized.');
//   }
// }


// const db = admin.firestore();

// async function migrateMessages() {
//   console.log('Starting message migration...');

//   const chatRoomsRef = db.collection('chatRooms');
//   const snapshot = await chatRoomsRef.get();

//   if (snapshot.empty) {
//     console.log('No chat rooms found.');
//     return;
//   }

//   let migratedCount = 0;
//   const batchSize = 100; // 한 번에 처리할 문서 수 (Firestore 배치 쓰기 한도는 500)
//   let batch = db.batch();
//   let operationCount = 0; // 배치 내 작업 수

//   for (const doc of snapshot.docs) {
//     const chatRoomId = doc.id;
//     const chatRoomData = doc.data();
//     const messages = chatRoomData.messages; // 기존 메시지 배열

//     // messages 필드가 배열이고 비어있지 않은 경우에만 마이그레이션 진행
//     if (Array.isArray(messages) && messages.length > 0) {
//       console.log(`Migrating messages for chat room: ${chatRoomId}`);
//       const messagesSubcollectionRef = chatRoomsRef.doc(chatRoomId).collection('messages');

//       for (const message of messages) {
//         // 메시지 ID가 있다면 해당 ID를 사용하고, 없다면 Firestore가 자동으로 생성하도록 합니다.
//         // 기존 메시지 객체에 id 필드가 있다고 가정합니다. 없다면 Firestore가 자동 ID를 생성합니다.
//         const messageId = message.id; // 기존 메시지 객체에 id 필드가 없다면 이 줄을 수정하거나 제거해야 합니다.
//         const messageData = { ...message };
//         // 만약 message 객체 내에 id 필드가 포함되어 있다면, 서브컬렉션 문서 데이터에는 포함하지 않을 수 있습니다.
//         // delete messageData.id; // 필요에 따라 주석 해제

//         const newMessageRef = messageId
//           ? messagesSubcollectionRef.doc(messageId)
//           : messagesSubcollectionRef.doc(); // ID가 없으면 자동 생성

//         batch.set(newMessageRef, messageData);
//         operationCount++;

//         // Firestore 배치 쓰기는 최대 500개의 작업을 포함할 수 있습니다. 안전하게 batchSize 마다 커밋합니다.
//         if (operationCount >= batchSize) {
//           console.log(`Committing batch of ${operationCount} message creations...`);
//           await batch.commit();
//           batch = db.batch(); // 새 배치 시작
//           operationCount = 0;
//         }
//       }

//       // 해당 채팅방의 모든 메시지 생성이 배치에 추가된 후, 기존 messages 필드 삭제 작업을 추가합니다.
//       batch.update(chatRoomsRef.doc(chatRoomId), {
//         messages: FieldValue.delete()
//       });
//       operationCount++;
//       migratedCount++;

//       // 필드 삭제 작업 추가 후에도 배치 크기를 확인하고 필요시 커밋합니다.
//       if (operationCount >= batchSize) {
//         console.log(`Committing batch of ${operationCount} operations (including delete)...`);
//         await batch.commit();
//         batch = db.batch(); // 새 배치 시작
//         operationCount = 0;
//       }

//     } else {
//       console.log(`Skipping chat room ${chatRoomId}: No messages array found or it's empty.`);
//     }
//   }

//   // 루프 종료 후 남은 작업이 있다면 커밋합니다.
//   if (operationCount > 0) {
//     console.log(`Committing final batch of ${operationCount} operations...`);
//     await batch.commit();
//   }

//   console.log(`Migration complete. Processed ${snapshot.size} chat rooms. Migrated messages for ${migratedCount} chat rooms.`);
// }

// migrateMessages().then(() => {
//   console.log('Migration script finished successfully.');
//   process.exit(0); // 성공 시 종료
// }).catch(error => {
//   console.error('Error during migration:', error);
//   process.exit(1); // 오류 발생 시 종료
// });