// In src/utils/pointUtils.ts
import { db } from '../firebase/config';
import { POINT_BALANCES_COLLECTION, POINT_TRANSACTIONS_COLLECTION } from '../firebase/collections';
import { collection, doc, runTransaction, Timestamp } from 'firebase/firestore';
import { PointTransaction } from '../types/point';

export async function addPointsToCreator(
  creatorId: string,
  pointsToAward: number,
  interactingUserId: string,
  characterName: string,
  usageType: string, // e.g., '채팅', '로어 생성'
  relatedId: string, // e.g., characterId
) {
  // 생성자와 상호작용 유저가 같으면 포인트 미지급
  if (creatorId === interactingUserId) {
    console.log("Creator interacting with own character. No points awarded.");
    return;
  }
  if (pointsToAward <= 0) return;

  const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, creatorId);
  const transactionCollection = collection(db, POINT_TRANSACTIONS_COLLECTION);
  const pointTransactionRef = doc(transactionCollection);

  try {
    await runTransaction(db, async (transaction) => {
      const balanceDoc = await transaction.get(pointBalanceRef);
      const currentBalance = balanceDoc.exists() ? balanceDoc.data().balance : 0;
      const newBalance = currentBalance + pointsToAward;

      transaction.set(pointBalanceRef, { userId: creatorId, balance: newBalance, lastUpdated: Timestamp.now() }, { merge: true });

      const newTransaction: PointTransaction = {
        id: pointTransactionRef.id,
        userId: creatorId,
        type: 'creator_reward',
        amount: pointsToAward,
        description: `${characterName} 캐릭터 ${usageType} 보상 (from: ${interactingUserId})`,
        transactionDate: Timestamp.now().toDate(),
        relatedId,
      };
      transaction.set(pointTransactionRef, newTransaction);
    });
    console.log(`Successfully awarded ${pointsToAward} points to creator ${creatorId} for ${usageType} with ${characterName}.`);
  } catch (error) {
    console.error(`Failed to award points to creator ${creatorId}:`, error);
  }
}