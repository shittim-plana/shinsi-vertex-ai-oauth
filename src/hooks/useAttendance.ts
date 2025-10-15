import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { AttendanceState, ClaimResponse } from '@/types/attendance';
import { db } from '@/firebase/firebase';
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  setDoc,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { getCurrentKST, isSameKSTDay, getKSTMonthRange } from '@/utils/dateUtils';

const BASE_REWARD = 10000;
const MAX_MULTIPLIER = 1.0;
const MULTIPLIER_INCREMENT = 0.1;

function calculateReward(claimCount: number): { multiplier: number; reward: number } {
  const multiplier = Math.min(1.0 + MULTIPLIER_INCREMENT * claimCount, MAX_MULTIPLIER);
  const reward = Math.floor(BASE_REWARD * multiplier);
  return { multiplier, reward };
}

export function useAttendance() {
  const { uid, user } = useAuth();
  const [status, setStatus] = useState<Partial<ClaimResponse>>({
    todayClaimed: false,
    claimCount: 0,
    multiplier: 1.0,
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!uid) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { now, todayKST, currentMonthKey } = getCurrentKST();
      const { to: monthResetAt } = getKSTMonthRange(now);
      const resetAtKST = monthResetAt.toISOString();

      const attendanceRef = doc(db, 'users', uid, 'attendance', currentMonthKey);
      const snap = await getDoc(attendanceRef);

      let claimCount = 0;
      let multiplier = 1.0;
      let todayClaimed = false;
      if (snap.exists()) {
        const data = snap.data() as AttendanceState;
        claimCount = data.claimCount || 0;
        const last = (data.lastClaimedAt as unknown as Timestamp)?.toDate?.() || new Date(0);
        todayClaimed = isSameKSTDay(last, now);
        const calc = calculateReward(claimCount);
        multiplier = calc.multiplier;
      }

      setStatus({
        success: true,
        todayClaimed,
        claimCount,
        multiplier,
        nextMultiplier: calculateReward(claimCount).multiplier,
        awardedAmount: 0,
        monthKey: currentMonthKey,
        resetAtKST,
      });
    } catch (e: any) {
      setError(e.message || '상태를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  const claimAttendance = useCallback(async (): Promise<ClaimResponse | undefined> => {
    if (!uid || !user) {
      setError('로그인이 필요합니다.');
      return;
    }

    setLoading(true);
    try {
      const idempotencyKey = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const result = await runTransaction(db, async (tx) => {
        const { now, todayKST, currentMonthKey } = getCurrentKST();
        const { to: monthResetAt } = getKSTMonthRange(now);
        const resetAtKST = monthResetAt.toISOString();

        const attendanceRef = doc(db, 'users', uid, 'attendance', currentMonthKey);
        const pointBalanceRef = doc(db, 'pointBalances', uid);
        const pointTransactionRef = doc(db, 'pointTransactions', idempotencyKey);

        const [attendanceDoc, pointBalanceDoc, pointTxDoc] = await Promise.all([
          tx.get(attendanceRef),
          tx.get(pointBalanceRef),
          tx.get(pointTransactionRef),
        ]);

        let attendanceState: AttendanceState;
        if (!attendanceDoc.exists()) {
          attendanceState = {
            monthKey: currentMonthKey,
            lastClaimedAt: Timestamp.fromMillis(0) as any,
            claimCount: 0,
            currentMultiplier: 1.0,
            totalAwarded: 0,
            dayList: [],
            createdAt: serverTimestamp() as any,
            updatedAt: serverTimestamp() as any,
          };
        } else {
          attendanceState = attendanceDoc.data() as AttendanceState;
        }

        // 멱등성: 동일 키 처리
        if (pointTxDoc.exists()) {
          const { multiplier, reward } = calculateReward(attendanceState.claimCount);
          const currentBalance = pointBalanceDoc.exists() ? (pointBalanceDoc.data() as any).balance : 0;
          return {
            success: true,
            message: '이미 처리된 요청입니다.',
            awardedAmount: reward,
            multiplier,
            nextMultiplier: calculateReward(attendanceState.claimCount + 1).multiplier,
            claimCount: attendanceState.claimCount,
            monthKey: currentMonthKey,
            todayClaimed: true,
            resetAtKST,
            balance: currentBalance,
          } as ClaimResponse;
        }

        // 오늘 이미 출석 여부
        const lastClaimedDate = (attendanceState.lastClaimedAt as unknown as Timestamp)?.toDate?.() || new Date(0);
        const alreadyToday = isSameKSTDay(lastClaimedDate, now);
        if (alreadyToday) {
          const { multiplier, reward } = calculateReward(attendanceState.claimCount);
          const currentBalance = pointBalanceDoc.exists() ? (pointBalanceDoc.data() as any).balance : 0;
          return {
            success: true,
            todayClaimed: true,
            message: '오늘 이미 출석 보상을 받았습니다.',
            awardedAmount: reward,
            multiplier,
            nextMultiplier: calculateReward(attendanceState.claimCount + 1).multiplier,
            claimCount: attendanceState.claimCount,
            monthKey: currentMonthKey,
            resetAtKST,
            balance: currentBalance,
          } as ClaimResponse;
        }

        // 보상 계산: 증가 후 회차 기준
        const newClaimCount = attendanceState.claimCount + 1;
        const { multiplier, reward } = calculateReward(newClaimCount);
        const newTotalAwarded = (attendanceState.totalAwarded || 0) + reward;
        const dayStr = String(todayKST.day).padStart(2, '0');

        // attendance upsert
        if (!attendanceDoc.exists()) {
          const newDoc: AttendanceState = {
            monthKey: currentMonthKey,
            lastClaimedAt: serverTimestamp() as any,
            claimCount: newClaimCount,
            currentMultiplier: multiplier,
            totalAwarded: newTotalAwarded,
            dayList: [dayStr],
            createdAt: serverTimestamp() as any,
            updatedAt: serverTimestamp() as any,
          };
          tx.set(attendanceRef, newDoc);
        } else {
          // arrayUnion을 사용하여 같은 날 중복 추가를 방지 (규칙에서 dayList size +1을 강제)
          tx.update(attendanceRef, {
            lastClaimedAt: serverTimestamp(),
            claimCount: newClaimCount,
            currentMultiplier: multiplier,
            totalAwarded: newTotalAwarded,
            dayList: arrayUnion(dayStr),
            updatedAt: serverTimestamp(),
          });
        }

        // point balance upsert
        const currentBalance = pointBalanceDoc.exists() ? (pointBalanceDoc.data() as any).balance : 0;
        const newBalance = currentBalance + reward;
        if (!pointBalanceDoc.exists()) {
          tx.set(pointBalanceRef, { userId: uid, balance: newBalance, lastUpdated: serverTimestamp(), lastTxId: idempotencyKey }, { merge: true });
        } else {
          tx.set(pointBalanceRef, { userId: uid, balance: newBalance, lastUpdated: serverTimestamp(), lastTxId: idempotencyKey }, { merge: true });
        }

        // point transaction create
        tx.set(pointTransactionRef, {
          id: idempotencyKey,
          userId: uid,
          type: 'attendance',
          amount: reward,
          description: `출석 보상 (배수: ${multiplier}, 월: ${currentMonthKey})`,
          transactionDate: serverTimestamp(),
          relatedId: currentMonthKey,
        });

        return {
          success: true,
          awardedAmount: reward,
          multiplier,
          nextMultiplier: calculateReward(newClaimCount + 1).multiplier,
          claimCount: newClaimCount,
          monthKey: currentMonthKey,
          todayClaimed: true,
          resetAtKST,
          balance: newBalance,
        } as ClaimResponse;
      });

      setStatus(result);
      return result;
    } catch (e: any) {
      console.error('출석 트랜잭션 오류:', e);
      setError(e.message || '출석 처리 중 오류가 발생했습니다.');
      return { success: false, message: e.message || 'TRANSACTION_ERROR', awardedAmount: 0, multiplier: 1.0, nextMultiplier: 1.0, claimCount: status.claimCount || 0, monthKey: status.monthKey || '', todayClaimed: !!status.todayClaimed, resetAtKST: status.resetAtKST || '' } as ClaimResponse;
    } finally {
      setLoading(false);
    }
  }, [uid, user, status.claimCount, status.monthKey, status.todayClaimed, status.resetAtKST]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, loading, error, claimAttendance, refreshStatus: fetchStatus };
}