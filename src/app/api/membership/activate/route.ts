import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';

const MEMBERSHIP_CODES: Record<string, 'none' | 'basic' | 'low_premium' | 'premium'> = {
  'NONE123': 'none',
  '42b1cf3b-d862-4ce7-8a91-042e7122d713': 'basic',
  'a4b6f666-bc43-45a5-bcd2-433d7c517288': 'low_premium',
  '0797f14b-ad47-4f9f-aadb-0e421ab1df8f': 'premium',
};

export async function POST(req: NextRequest) {
  try {
    const { code, userId } = await req.json();
    if (!code || !userId) {
      return NextResponse.json({ error: 'Code and userId are required.' }, { status: 400 });
    }

    const tier = MEMBERSHIP_CODES[String(code)];
    if (!tier) {
      return NextResponse.json({ error: 'Invalid membership code.' }, { status: 400 });
    }

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const userData = userSnap.data() as any;
    const currentSettings = userData.settings || {};
    const updatedSettings = { ...currentSettings };

    await updateDoc(userRef, {
      membershipTier: tier,
      settings: updatedSettings,
    });

    return NextResponse.json({
      message: `Membership activated: ${tier}. Please log out and log back in to apply changes.`,
      tier,
      logoutRequired: true,
      postLogoutMessage: '로그인 후에 프리미엄 멤버십 혜택이 적용됩니다.'
    });
  } catch (error: any) {
    console.error('Membership activation error:', error);
    return NextResponse.json({ error: 'Failed to activate membership.' }, { status: 500 });
  }
}
