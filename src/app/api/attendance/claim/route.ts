// /src/app/api/attendance/claim/route.ts
export const runtime = 'nodejs';
export const maxDuration = 60;
import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import { getFirestore, Transaction, DocumentReference } from 'firebase-admin/firestore';
import { Timestamp as AdminTimestamp, FieldValue } from 'firebase-admin/firestore';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import { v4 as uuidv4 } from 'uuid';
import { Timestamp } from 'firebase/firestore';

import { AttendanceState, ClaimResponse } from '@/types/attendance';
import { PointBalance, PointTransaction } from '@/types/point';
import { getCurrentKST, isSameKSTDay, getKSTMonthRange } from '@/utils/dateUtils';
import { adminApp } from '@/firebase/firebaseAdmin';

const db = getFirestore(adminApp);
const auth = getAuth(adminApp);

const BASE_REWARD = 10000;
const MAX_MULTIPLIER = 1.0;
const MULTIPLIER_INCREMENT = 0.1;

/**
 * Calculates the attendance reward based on the claim count.
 * @param {number} claimCount - The number of claims this month.
 * @returns {{multiplier: number, reward: number}} - The calculated multiplier and reward.
 */
function calculateReward(claimCount: number): { multiplier: number, reward: number } {
  // The first claim has a count of 0 for calculation purposes.
  //Multipler starts at 1.0, and increases by 0.1 for each subsequent claim.
  const multiplier = Math.min(1.0 + MULTIPLIER_INCREMENT * claimCount, MAX_MULTIPLIER);
  const reward = Math.floor(BASE_REWARD * multiplier);
  return { multiplier, reward };
}

export async function POST(req: NextRequest) {
  const idempotencyKey = req.headers.get('Idempotency-Key') || uuidv4();
  let uid: string;

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return NextResponse.json({ success: false, error: 'UNAUTHORIZED', message: '인증 헤더가 없습니다.' }, { status: 401 });
    }
    const token = authHeader.split('Bearer ')[1];
    const decodedToken: DecodedIdToken = await auth.verifyIdToken(token);
    uid = decodedToken.uid;
  } catch (error) {
    console.error('Authentication error:', error);
    return NextResponse.json({ success: false, error: 'UNAUTHORIZED', message: '유효하지 않은 토큰입니다.' }, { status: 401 });
  }

  const { now, todayKST, currentMonthKey } = getCurrentKST();
  const { to: monthResetAt } = getKSTMonthRange(now);
  const resetAtKST = monthResetAt.toISOString();
  
  const { checkStatusOnly } = req.method === 'POST' ? (await req.json().catch(() => ({}))) : { checkStatusOnly: false };


  const attendanceRef: DocumentReference<AttendanceState> = db.collection('users').doc(uid).collection('attendance').doc(currentMonthKey) as DocumentReference<AttendanceState>;
  const pointBalanceRef: DocumentReference<PointBalance> = db.collection('pointBalances').doc(uid) as DocumentReference<PointBalance>;
  const pointTransactionRef: DocumentReference<PointTransaction> = db.collection('pointTransactions').doc(idempotencyKey) as DocumentReference<PointTransaction>;


  try {
    const result: ClaimResponse = await db.runTransaction(async (transaction: Transaction): Promise<ClaimResponse> => {
      const attendanceDoc = await transaction.get(attendanceRef);
      let attendanceState: AttendanceState;

      if (!attendanceDoc.exists) {
        attendanceState = {
          monthKey: currentMonthKey,
          lastClaimedAt: AdminTimestamp.fromMillis(0) as unknown as Timestamp,
          claimCount: 0,
          currentMultiplier: 1.0,
          totalAwarded: 0,
          dayList: [],
          createdAt: FieldValue.serverTimestamp() as unknown as Timestamp,
          updatedAt: FieldValue.serverTimestamp()as unknown as Timestamp
        };
      } else {
        attendanceState = attendanceDoc.data() as AttendanceState;
      }

      const lastClaimedDate = (attendanceState.lastClaimedAt as unknown as AdminTimestamp).toDate();
      const todayClaimed = isSameKSTDay(lastClaimedDate, now);
      
      if (checkStatusOnly) {
          // Status-only: after-claim semantics. claimCount already reflects last paid count.
          const currentCalc = calculateReward(attendanceState.claimCount);
          if (attendanceState.claimCount >= 10) {
            return {
              success: false,
              todayClaimed,
              claimCount: attendanceState.claimCount,
              multiplier: currentCalc.multiplier,
              nextMultiplier: currentCalc.multiplier,
              awardedAmount: 0,
              monthKey: currentMonthKey,
              resetAtKST,
              error: 'ATTENDANCE_CAPPED_THIS_MONTH',
              message: '이 달은 2.0배 달성으로 출석이 마감되었습니다.',
            };
          }
          return {
              success: true,
              todayClaimed,
              claimCount: attendanceState.claimCount,
              multiplier: currentCalc.multiplier,
              nextMultiplier: calculateReward(attendanceState.claimCount + 1).multiplier,
              awardedAmount: 0,
              monthKey: currentMonthKey,
              resetAtKST,
          };
      }
      
      if (todayClaimed) {
        const { multiplier, reward } = calculateReward(attendanceState.claimCount);
        return {
          success: true,
          todayClaimed: true,
          message: '오늘 이미 출석 보상을 받았습니다.',
          awardedAmount: reward,
          multiplier: multiplier,
          nextMultiplier: calculateReward(attendanceState.claimCount).multiplier,
          claimCount: attendanceState.claimCount,
          monthKey: currentMonthKey,
          resetAtKST,
        };
      }

      // Firestore transactions require all reads to be executed before all writes.
      const pointTransactionDoc = await transaction.get(pointTransactionRef);
      const pointBalanceDoc = await transaction.get(pointBalanceRef);
 
      if (pointTransactionDoc.exists) {
        // Idempotency: If this transaction has been processed, return the stored result.
        const { multiplier, reward } = calculateReward(attendanceState.claimCount);
        return {
          success: true,
          message: '이미 처리된 요청입니다.',
          awardedAmount: reward,
          multiplier,
          nextMultiplier: calculateReward(attendanceState.claimCount).multiplier,
          claimCount: attendanceState.claimCount,
          monthKey: currentMonthKey,
          todayClaimed: true,
          resetAtKST
        };
      }
 
      // Monthly cap (strengthened): evaluate after-increment count to prevent exceeding 10 within transaction
      const proposedCount = attendanceState.claimCount + 1;
      if (proposedCount > 10) {
        console.warn(`[attendance] Monthly cap reached. Blocking claim uid=${uid}, month=${currentMonthKey}, claimCount=${attendanceState.claimCount}, proposed=${proposedCount}`);
        const cappedResponse: ClaimResponse = {
          success: false,
          awardedAmount: 0,
          multiplier: calculateReward(attendanceState.claimCount).multiplier,
          nextMultiplier: calculateReward(attendanceState.claimCount).multiplier,
          claimCount: attendanceState.claimCount,
          monthKey: currentMonthKey,
          todayClaimed: false,
          resetAtKST,
          error: 'ATTENDANCE_CAPPED_THIS_MONTH',
          message: '이 달은 2.0배 달성으로 출석이 마감되었습니다.',
        };
        return cappedResponse;
      }

      const newClaimCount = proposedCount;
      const { multiplier, reward } = calculateReward(newClaimCount);
      const newTotalAwarded = attendanceState.totalAwarded + reward;
      const newDayList = [...attendanceState.dayList, todayKST.day.toString().padStart(2, '0')];

      const newAttendanceState: Omit<AttendanceState, 'createdAt'> & { createdAt?: AdminTimestamp } = {
        monthKey: currentMonthKey,
        lastClaimedAt: AdminTimestamp.now() as unknown as Timestamp,
        claimCount: newClaimCount,
        currentMultiplier: multiplier,
        totalAwarded: newTotalAwarded,
        dayList: newDayList,
        updatedAt: FieldValue.serverTimestamp() as unknown as Timestamp,
      };

      // All writes are now after all reads.
      if (!attendanceDoc.exists) {
        newAttendanceState.createdAt = FieldValue.serverTimestamp() as unknown as AdminTimestamp;
        transaction.create(attendanceRef, newAttendanceState as any);
      } else {
        transaction.update(attendanceRef, newAttendanceState as any);
      }

      const currentBalance = pointBalanceDoc.exists ? pointBalanceDoc.data()!.balance : 0;
      const newBalance = currentBalance + reward;
      transaction.set(pointBalanceRef, { balance: newBalance, lastUpdated: FieldValue.serverTimestamp() }, { merge: true });

      const newTransaction: PointTransaction = {
        id: idempotencyKey,
        userId: uid,
        type: 'attendance',
        amount: reward,
        description: `출석 보상 (배수: ${multiplier}, 월: ${currentMonthKey})`,
        transactionDate: AdminTimestamp.now().toDate(),
        relatedId: currentMonthKey,
      };
      transaction.set(pointTransactionRef, newTransaction);
      
      return {
        success: true,
        awardedAmount: reward,
        multiplier,
        nextMultiplier: calculateReward(newClaimCount + 1).multiplier,
        claimCount: newClaimCount,
        monthKey: currentMonthKey,
        todayClaimed: true,
        resetAtKST,
        balance: newBalance
      };
    });

    if ((result as any).error === 'ATTENDANCE_CAPPED_THIS_MONTH' && !checkStatusOnly) {
      return NextResponse.json(
        { code: 'ATTENDANCE_CAPPED_THIS_MONTH', message: '이 달은 2.0배 달성으로 출석이 마감되었습니다.' },
        { status: 403 }
      );
    }
    return NextResponse.json(result, { status: 200 });

  } catch (error) {
    console.error('Error in attendance claim transaction:', error);
    return NextResponse.json({ success: false, error: 'INTERNAL_ERROR', message: '출석 보상 처리 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
