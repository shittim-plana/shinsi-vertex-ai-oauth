import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { collection, doc, runTransaction, Timestamp, query, where, getDocs } from 'firebase/firestore';
import {
  POINT_BALANCES_COLLECTION,
  POINT_TRANSACTIONS_COLLECTION,
  getPointBalanceDocId,
} from '@/firebase/collections';
import { PointBalance, PointTransaction, PointTransactionType, RedemptionCode, RedemptionCodeStatus } from '@/types/point';

const REDEMPTION_CODES_COLLECTION = 'redemptionCodes';

export async function POST(req: NextRequest) {
  try {
    const { code, userId } = await req.json();

    if (!code || !userId) {
      return NextResponse.json({ error: 'Redemption code and userId are required.' }, { status: 400 });
    }

    const result = await runTransaction(db, async (transaction) => {
      const codeQuery = query(collection(db, REDEMPTION_CODES_COLLECTION), where('code', '==', code));
      const codeSnapshot = await getDocs(codeQuery);

      if (codeSnapshot.empty) {
        throw new Error('Invalid or non-existent redemption code.');
      }

      const codeDoc = codeSnapshot.docs[0];
      const codeData = codeDoc.data() as RedemptionCode;
      const codeRef = codeDoc.ref;

      if (codeData.status !== RedemptionCodeStatus.Unused) {
        throw new Error('This code has already been used or is expired.');
      }

      // 포인트 잔액 문서 참조
      const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(userId));
      const pointBalanceSnap = await transaction.get(pointBalanceRef);
      let currentBalance = 0;
      if (pointBalanceSnap.exists()) {
        currentBalance = (pointBalanceSnap.data() as PointBalance).balance;
      }

      const newBalance = currentBalance + codeData.pointsValue;

      // 1. 코드 사용 처리
      const codeUpdateData: Partial<RedemptionCode> = {
        status: RedemptionCodeStatus.Used,
        usedBy: userId,
        usedAt: Timestamp.now(),
      };
      transaction.update(codeRef, codeUpdateData);

      // 2. 사용자 포인트 잔액 업데이트
      transaction.set(pointBalanceRef, { userId, balance: newBalance, lastUpdated: Timestamp.now() }, { merge: true });

      // 3. 포인트 거래 내역 생성
      const transactionId = doc(collection(db, POINT_TRANSACTIONS_COLLECTION)).id;
      const pointTransactionRef = doc(db, POINT_TRANSACTIONS_COLLECTION, transactionId);
      const newTransaction: PointTransaction = {
        id: transactionId,
        userId,
        type: 'patreon_reward' as PointTransactionType,
        amount: codeData.pointsValue,
        description: codeData.description || `Patreon reward redeemed: ${codeData.code}`,
        transactionDate: Timestamp.now().toDate(),
        relatedId: codeDoc.id,
      };
      transaction.set(pointTransactionRef, newTransaction);

      return {
        message: `Code redeemed successfully. ${codeData.pointsValue} points added.`,
        newBalance: newBalance,
        codeId: codeDoc.id,
      };
    });

    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error('Error redeeming code:', error);
    return NextResponse.json({ error: error.message || 'Failed to redeem code.' }, { status: 500 });
  }
}