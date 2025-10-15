// // Simplified seeding script in plain JS to avoid TypeScript module resolution issues
// const { initializeApp, cert } = require('firebase-admin/app');
// const { getFirestore, Timestamp } = require('firebase-admin/firestore');
// const { v4: uuidv4 } = require('uuid');
// const { config } = require('dotenv');

// // Load environment variables
// config();

// console.log('Initializing Firebase Admin SDK...');

// // Initialize Firebase Admin SDK
// const app = initializeApp({
//   projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
// });

// const db = getFirestore();

// // Admin user information
// const ADMIN_USER_ID = process.env.ADMIN_USER_ID || 'gM2JhQZY4Ue7dm1vqpewprmDTXk2';
// const ADMIN_USER_NAME = process.env.ADMIN_USER_NAME || 'Legis';

// console.log('Using Firebase project:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
// console.log('Admin user:', ADMIN_USER_NAME, `(${ADMIN_USER_ID})`);

// // No need to check permissions with Admin SDK as it bypasses security rules

// // Sample character data (directly from character-utils.ts)
// const sampleCharacters = [
//   {
//     name: '아로나',
//     description: '푸른 각과 소속 학생',
//     detail: '밀레니엄 과학학교에 소속된 학생으로, 푸른 각이라 불리는 팀의 멤버입니다. 선생님을 돕는 것을 좋아하며 친절하고 도움을 주는 것을 좋아합니다.',
//     firstMessage: '안녕하세요, 선생님! 오늘은 제가 어떻게 도와드릴까요?',
//     image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Farona.png?alt=media',
//     isPublic: true,
//     isNSFW: false,
//     tags: ['블루아카이브', '게임', '아로나', '푸른각']
//   },
//   {
//     name: '유이카',
//     description: '밀레니엄 과학학교 학생회장',
//     detail: '밀레니엄 과학학교의 학생회장으로, 기발한 아이디어와 넘치는 에너지를 가지고 있습니다. 학교를 발전시키기 위해 다양한 계획을 추진하며, 때로는 무모해 보이지만 모두를 위한 마음을 가지고 있습니다.',
//     firstMessage: '어라? 새로운 선생님인가요? 반가워요! 저는 유이카, 밀레니엄 과학학교 학생회장이에요!',
//     image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Fyuuka.png?alt=media',
//     isPublic: true,
//     isNSFW: false,
//     tags: ['블루아카이브', '게임', '유이카', '밀레니엄']
//   },
//   {
//     name: '미카',
//     description: '친절한 AI 도우미',
//     detail: '이용자의 질문에 항상 친절하게 답변해주는 AI 도우미입니다. 다양한 주제에 대한 지식을 갖추고 있으며, 대화를 통해 도움을 제공합니다.',
//     firstMessage: '안녕하세요! 저는 미카예요. 무엇을 도와드릴까요?',
//     isPublic: true,
//     isNSFW: false,
//     tags: ['AI', '도우미', '친절한']
//   },
//   {
//     name: '하루',
//     description: '게임을 좋아하는 고양이',
//     detail: '비디오 게임을 좋아하는 호기심 많은 고양이입니다. 특히 RPG 게임에 관심이 많고, 게임에 대한 이야기를 나누는 것을 좋아합니다.',
//     firstMessage: '냥! 오늘은 어떤 게임 이야기를 할까요?',
//     image: 'https://firebasestorage.googleapis.com/v0/b/new-arona-bot-mk-2.appspot.com/o/sampleCharacters%2Fcat.png?alt=media',
//     isPublic: true,
//     isNSFW: false,
//     tags: ['고양이', '게임', '귀여운']
//   },
//   {
//     name: '교수',
//     description: '역사학 교수',
//     detail: '역사학을 전공한 대학 교수로, 특히 세계사에 관한 깊은 지식을 가지고 있습니다. 역사적 사건과 인물에 관한 흥미로운 이야기를 들려주는 것을 좋아합니다.',
//     firstMessage: '안녕하세요! 오늘은 어떤 역사적 이야기가 궁금하신가요?',
//     isPublic: true,
//     isNSFW: false,
//     tags: ['역사', '교육', '교수']
//   }
// ];

// /**
//  * Seed characters to the database using Admin SDK
//  */
// async function seedCharacters() {
//   try {
//     const characterIds = [];
//     const charactersRef = db.collection('characters');

//     // Check for existing sample characters
//     const existingDocs = await charactersRef
//       .where('creatorId', '==', ADMIN_USER_ID)
//       .where('tags', 'array-contains', 'sample')
//       .get();
    
//     // Delete existing sample characters
//     const deletePromises = [];
//     existingDocs.forEach((doc) => {
//       deletePromises.push(doc.ref.delete());
//     });
    
//     if (deletePromises.length > 0) {
//       await Promise.all(deletePromises);
//       console.log(`${deletePromises.length} existing sample characters deleted.`);
//     }

//     // Create new sample characters
//     for (const sampleChar of sampleCharacters) {
//       const characterId = uuidv4();
      
//       // Add 'sample' tag for identification
//       const tags = [...sampleChar.tags, 'sample'];
      
//       const now = Timestamp.now();
//       const characterData = {
//         ...sampleChar,
//         creatorId: ADMIN_USER_ID,
//         creatorName: ADMIN_USER_NAME,
//         tags,
//         createdAt: now,
//         lastUpdated: now,
//       };
      
//       // Save to Firestore using Admin SDK
//       await charactersRef.doc(characterId).set(characterData);
//       characterIds.push(characterId);
//       console.log(`Character created: ${sampleChar.name} (ID: ${characterId})`);
//     }
    
//     console.log(`${characterIds.length} sample characters successfully created.`);
//     return characterIds;
//   } catch (error) {
//     console.error('Error seeding characters:', error);
//     throw error;
//   }
// }

// async function main() {
//   console.log('Starting database seeding process with Admin SDK...');
  
//   try {
//     // Seed characters (Admin SDK bypasses security rules, so no need to check permissions)
//     const characterIds = await seedCharacters();
    
//     console.log('Database seeding completed successfully!');
//     console.log(`Created ${characterIds.length} sample characters.`);
//     console.log('Character IDs:', characterIds);
//   } catch (error) {
//     console.error('Error in seeding process:', error);
//     process.exit(1);
//   }
// }

// // Run the seeding process
// // main().then(() => process.exit(0));