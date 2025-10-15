'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { db, pointBalanceDoc, pointTransactionDoc } from '@/firebase/config';
import { runTransaction, serverTimestamp } from 'firebase/firestore';

export default function PaymentSuccessClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { uid } = useAuth();

  const sessionId = searchParams.get('session_id');
  const priceId = searchParams.get('price_id');
  const pointsParam = searchParams.get('points');
  const calledRef = useRef(false);

  useEffect(() => {
    const credit = async () => {
      if (calledRef.current) return;
      if (!sessionId || !uid) {
        router.replace('/');
        return;
      }
      calledRef.current = true;

      try {
        let pointsToAdd: number | undefined = pointsParam ? parseInt(pointsParam, 10) : undefined;
        if (!Number.isFinite(pointsToAdd as number) || (pointsToAdd as number) <= 0) {
          const mapping: Record<string, number> = {
            'price_1RsYFNLpyVRnWjRZCyKTTS9U': 500000,
            'price_1RsYMDLpyVRnWjRZghaxE8fD': 1000000,
            'price_1RsYMVLpyVRnWjRZXhHLNyJL': 2000000,
          };
          if (priceId && mapping[priceId]) {
            pointsToAdd = mapping[priceId];
          }
        }

        if (!pointsToAdd || !Number.isFinite(pointsToAdd) || pointsToAdd <= 0) {
          return;
        }

        await runTransaction(db, async (tx) => {
          const txRef = pointTransactionDoc(sessionId);
          const existing = await tx.get(txRef);
          if (existing.exists()) {
            return;
          }
          const balanceRef = pointBalanceDoc(uid);
          const balanceSnap = await tx.get(balanceRef);
          const current = balanceSnap.exists() ? (balanceSnap.data() as any).balance || 0 : 0;
          const newBalance = current + pointsToAdd!;

          tx.set(txRef, {
            id: sessionId,
            userId: uid,
            type: 'stripe_purchase',
            amount: pointsToAdd,
            description: `Stripe-결제 (${priceId || 'unknown'})`,
            transactionDate: serverTimestamp(),
            relatedId: sessionId,
          });

          tx.set(
            balanceRef,
            { userId: uid, balance: newBalance, lastUpdated: serverTimestamp(), lastTxId: sessionId },
            { merge: true }
          );
        });
      } catch (e) {
        console.error('Failed to credit points on client', e);
      } finally {
        setTimeout(() => {
          router.replace('/');
        }, 0);
      }
    };

    credit();
  }, [sessionId, uid, priceId, pointsParam, router]);

  return null;
}