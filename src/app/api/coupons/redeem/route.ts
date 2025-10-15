import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { collection, doc, runTransaction, Timestamp, query, where, getDocs, writeBatch } from 'firebase/firestore';
import {
  POINT_BALANCES_COLLECTION,
  POINT_TRANSACTIONS_COLLECTION,
  USERS_COLLECTION,
  getPointBalanceDocId,
} from '@/firebase/collections';
import { Coupon, PointBalance, PointTransaction, PointTransactionType } from '@/types/point';

// 쿠폰 컬렉션 이름 정의 (실제 컬렉션 이름과 일치해야 함)
const COUPONS_COLLECTION = 'coupons';

export async function POST(req: NextRequest) {
  try {
    const { code, userId } = await req.json();

    if (!code || !userId) {
      return NextResponse.json({ error: 'Coupon code and userId are required.' }, { status: 400 });
    }

    // Firestore 트랜잭션 시작
    const result = await runTransaction(db, async (transaction) => {
      const couponQuery = query(collection(db, COUPONS_COLLECTION), where('code', '==', code));
      const couponSnapshot = await getDocs(couponQuery); // getDocs는 transaction 외부에서 실행해야 할 수 있음, 또는 transaction.get(query) 방식 사용

      if (couponSnapshot.empty) {
        throw new Error('Invalid or non-existent coupon code.');
      }

      const couponDoc = couponSnapshot.docs[0]; // 첫 번째 매칭되는 쿠폰 사용
      const couponData = couponDoc.data() as Coupon;
      const couponRef = couponDoc.ref;

      if (couponData.isUsed) {
        throw new Error('This coupon has already been used.');
      }

      if (couponData.expiresAt && couponData.expiresAt.toDate() < new Date()) {
        throw new Error('This coupon has expired.');
      }
      
      // (선택 사항) 최대 사용 횟수 및 현재 사용 횟수 체크
      if (couponData.maxUses && couponData.currentUses !== undefined && couponData.currentUses >= couponData.maxUses) {
        throw new Error('This coupon has reached its maximum usage limit.');
      }


      // 포인트 잔액 문서 참조
      const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(userId));
      const pointBalanceSnap = await transaction.get(pointBalanceRef);
      let currentBalance = 0;
      if (pointBalanceSnap.exists()) {
        currentBalance = (pointBalanceSnap.data() as PointBalance).balance;
      }

      const newBalance = currentBalance + couponData.points;

      // 1. 쿠폰 사용 처리
      const couponUpdateData: Partial<Coupon> = {
        isUsed: true,
        usedBy: userId,
        usedAt: Timestamp.now(), // .toDate() 제거, Firestore Timestamp 직접 사용
      };
      if (couponData.maxUses && couponData.currentUses !== undefined) {
        couponUpdateData.currentUses = (couponData.currentUses || 0) + 1;
        if (couponUpdateData.currentUses >= couponData.maxUses) {
          // isUsed를 true로 설정하는 것은 maxUses가 1일 때와 동일하게 작동
          // 여러 번 사용 가능한 쿠폰의 경우, isUsed는 currentUses === maxUses 일 때 true로 설정
        }
      }
      transaction.update(couponRef, couponUpdateData);


      // 2. 사용자 포인트 잔액 업데이트
      transaction.set(pointBalanceRef, { userId, balance: newBalance, lastUpdated: Timestamp.now().toDate() }, { merge: true });

      // 3. 포인트 거래 내역 생성
      const transactionId = doc(collection(db, POINT_TRANSACTIONS_COLLECTION)).id;
      const pointTransactionRef = doc(db, POINT_TRANSACTIONS_COLLECTION, transactionId);
      const newTransaction: PointTransaction = {
        id: transactionId,
        userId,
        type: 'coupon_redemption' as PointTransactionType,
        amount: couponData.points,
        description: couponData.description || `Coupon redeemed: ${couponData.code}`,
        transactionDate: Timestamp.now().toDate(),
        relatedId: couponDoc.id, // 쿠폰 문서 ID를 관련 ID로 저장
      };
      transaction.set(pointTransactionRef, newTransaction);

      return {
        message: `Coupon redeemed successfully. ${couponData.points} points added.`,
        newBalance: newBalance,
        couponId: couponDoc.id,
      };
    });

    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error('Error redeeming coupon:', error);
    // Firestore 트랜잭션 내에서 발생한 오류는 'FirebaseError'일 수 있으며, message를 가짐
    // 직접 throw new Error() 한 경우도 message를 가짐
    return NextResponse.json({ error: error.message || 'Failed to redeem coupon.' }, { status: 500 });
  }
}