import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { headers } from 'next/headers';
import { adminApp } from '@/firebase/firebaseAdmin';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-07-30.basil',
});

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!;

const db = getFirestore(adminApp);

const pointMapping: { [key: string]: number } = {
  // 실제 Stripe Price ID를 여기에 매핑해야 합니다.
  'price_1RsYFNLpyVRnWjRZCyKTTS9U': 500000,
  'price_1RsYMDLpyVRnWjRZghaxE8fD': 1000000,
  'price_1RsYMVLpyVRnWjRZXhHLNyJL': 2000000,
};

export async function POST(req: NextRequest) {
  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    const rawBody = await req.text();
    event = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const userUid = session.metadata?.userUid as string | undefined;
 
    // priceId/Price 확보: metadata.priceId → 확장 조회(line_items.price) → 직접 Price 조회
    let priceId = (session.metadata?.priceId as string | undefined) || undefined;
    let expandedPrice: Stripe.Price | null = null;
    if (!priceId) {
      try {
        const fullSession = await stripe.checkout.sessions.retrieve(session.id as string, {
          expand: ['line_items.data.price']
        });
        const p = (fullSession.line_items?.data?.[0]?.price as Stripe.Price | undefined) || undefined;
        if (p) {
          expandedPrice = p;
          priceId = p.id;
        }
      } catch (e) {
        console.error('Failed to retrieve expanded Checkout Session for priceId:', e);
      }
    }
    if (!expandedPrice && priceId) {
      try {
        expandedPrice = await stripe.prices.retrieve(priceId);
      } catch (e) {
        console.warn('Failed to retrieve Price by priceId:', priceId, e);
      }
    }
 
    if (!userUid || !priceId) {
      console.error('Missing userUid or priceId (metadata/expanded lookup failed)', { userUid, priceId, sessionId: session.id });
      return NextResponse.json({ error: 'Missing metadata' }, { status: 400 });
    }
 
    // 포인트 산정: 1) 하드코딩 매핑 → 2) Price 메타데이터(points) → 실패 시 에러
    let pointsToAdd: number | undefined = pointMapping[priceId];
    if (!pointsToAdd && expandedPrice?.metadata?.points) {
      const parsed = parseInt(expandedPrice.metadata.points, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        pointsToAdd = parsed;
      }
    }
    if (!pointsToAdd) {
      console.error(`No point mapping found. priceId=${priceId}, price.metadata.points=${expandedPrice?.metadata?.points}`);
      return NextResponse.json({ error: 'Point mapping not found' }, { status: 400 });
    }

    try {
      const txId = session.id || event.id;
      const userPointBalanceRef = db.collection('pointBalances').doc(userUid);
      const pointTransactionRef = db.collection('pointTransactions').doc(txId);

      await db.runTransaction(async (transaction) => {
        // 멱등성: 이미 처리된 세션이면 스킵
        const existingTx = await transaction.get(pointTransactionRef);
        if (existingTx.exists) {
          return;
        }

        const pointBalanceSnap = await transaction.get(userPointBalanceRef);
        const currentBalance = pointBalanceSnap.exists ? pointBalanceSnap.data()!.balance : 0;
        const newBalance = currentBalance + pointsToAdd;

        // 거래 문서부터 생성
        transaction.set(pointTransactionRef, {
          id: txId,
          userId: userUid,
          type: 'stripe_purchase',
          amount: pointsToAdd,
          description: `Stripe-결제 (${priceId})`,
          transactionDate: Timestamp.now(),
          relatedId: session.id,
        });

        // 잔액 업데이트(해당 거래 ID와 함께 기록)
        transaction.set(
          userPointBalanceRef,
          { userId: userUid, balance: newBalance, lastUpdated: Timestamp.now(), lastTxId: txId },
          { merge: true }
        );
      });
      console.log(`Successfully added ${pointsToAdd} points to user ${userUid}`);

    } catch (error) {
      console.error('Error updating points:', error);
      return NextResponse.json({ error: 'Failed to update points' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}