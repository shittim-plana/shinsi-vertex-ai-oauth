import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { adminApp } from '@/firebase/firebaseAdmin';
import { getAuth, UserRecord } from 'firebase-admin/auth';

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables');
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil',
  typescript: true,
});

const auth = getAuth(adminApp);

const pointMapping: { [key: string]: number } = {
  'price_1RsYFNLpyVRnWjRZCyKTTS9U': 500000,
  'price_1RsYMDLpyVRnWjRZghaxE8fD': 1000000,
  'price_1RsYMVLpyVRnWjRZXhHLNyJL': 2000000,
};

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('Authorization')?.split('Bearer ')[1];
    if (!token) {
      return NextResponse.json({ error: 'Authorization header is missing' }, { status: 401 });
    }

    let user: UserRecord;
    try {
      const decodedToken = await auth.verifyIdToken(token);
      user = await auth.getUser(decodedToken.uid);
    } catch (error) {
      console.error('Error verifying token or getting user:', error);
      return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
    }

    const { priceId, userUid } = await req.json();

    if (!priceId || !userUid) {
      return NextResponse.json({ error: 'Price ID and User UID are required' }, { status: 400 });
    }
    
    if (user.uid !== userUid) {
      return NextResponse.json({ error: 'User UID does not match authenticated user' }, { status: 403 });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${req.nextUrl.origin}/payment/success?session_id={CHECKOUT_SESSION_ID}&price_id=${encodeURIComponent(priceId)}&points=${pointMapping[priceId] ?? ''}`,
      cancel_url: `${req.nextUrl.origin}/payment/cancel`,
      // 결제 후 Webhook에서 안정적으로 priceId를 알 수 있도록 metadata에 함께 저장
      metadata: {
        userUid: user.uid,
        priceId,
      },
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}