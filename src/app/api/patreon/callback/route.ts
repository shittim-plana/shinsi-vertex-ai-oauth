// src/app/api/patreon/callback/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { PATREON_USER_DATA_COLLECTION, POINT_BALANCES_COLLECTION, POINT_TRANSACTIONS_COLLECTION, USERS_COLLECTION, getPointBalanceDocId } from '@/firebase/collections';
import { PatreonMember, PatreonUserData } from '@/types/patreon';
import { PointBalance, PointTransaction, PATREON_TIER_REWARDS, PointTransactionType } from '@/types/point';
import { getAuth } from 'firebase-admin/auth';
import { adminApp } from '@/firebase/firebaseAdmin';
import { Timestamp, writeBatch, doc as firestoreDoc, getDoc, collection } from 'firebase/firestore';
import { db } from '@/firebase/config';

// Helper function to get Firebase Admin Auth instance
const getAdminAuth = () => {
  if (!adminApp) {
    throw new Error("Firebase Admin App not initialized. Check firebaseAdmin.ts.");
  }
  return getAuth(adminApp);
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const stateFromPatreon = searchParams.get('state');

  if (!code) {
    return NextResponse.json({ error: 'Authorization code not found.' }, { status: 400 });
  }

  if (!stateFromPatreon) {
    console.error('State parameter (Firebase User Email) missing from Patreon callback.');
    return NextResponse.json({ error: 'State parameter missing. Cannot link Patreon account.' }, { status: 400 });
  }
  const firebaseUserEmail = decodeURIComponent(stateFromPatreon);

  const clientId = process.env.PATREON_CLIENT_ID;
  const clientSecret = process.env.PATREON_CLIENT_SECRET;
  const redirectUri = process.env.PATREON_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Patreon client ID, secret, or redirect URI is not configured.');
    return NextResponse.json({ error: 'Patreon integration is not configured correctly.' }, { status: 500 });
  }

  try {
    // 1. Exchange authorization code for access token
    const tokenResponse = await fetch('https://www.patreon.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code: code,
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Patreon token exchange failed:', errorData);
      return NextResponse.json({ error: 'Failed to exchange Patreon token.', details: errorData }, { status: tokenResponse.status });
    }

    const tokenData = await tokenResponse.json();
    const { access_token, refresh_token, expires_in, scope } = tokenData;

    // 2. Fetch user's Patreon identity and membership info
    const identityResponse = await fetch(
      'https://www.patreon.com/api/oauth2/v2/identity?include=memberships,memberships.currently_entitled_tiers&fields[member]=patron_status,currently_entitled_amount_cents,last_charge_date,last_charge_status,pledge_relationship_start&fields[tier]=title,amount_cents',
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    if (!identityResponse.ok) {
      const errorData = await identityResponse.json();
      console.error('Patreon identity fetch failed:', errorData);
      return NextResponse.json({ error: 'Failed to fetch Patreon user data.', details: errorData }, { status: identityResponse.status });
    }

    const identityData = await identityResponse.json();
    const patreonApiUser = identityData.data;
    const patreonUserId = patreonApiUser.id;

    let aronaUserId: string;
    try {
      const adminAuth = getAdminAuth();
      const aronaUserRecord = await adminAuth.getUserByEmail(firebaseUserEmail);
      aronaUserId = aronaUserRecord.uid;
    } catch (error: any) {
      console.error(`Firebase user not found by email from state: ${firebaseUserEmail}`, error.message);
      return NextResponse.json({ error: `User with email ${firebaseUserEmail} not found in Firebase. Cannot link Patreon account.` }, { status: 404 });
    }

    // Extract membership details
    let currentTierId: string | undefined = undefined;
    let currentTierAmountCents: number = 0;
    let patronStatus: PatreonMember['attributes']['patron_status'] = null;
    let lastChargeDate: string | null = null;
    let lastChargeStatus: string | null = null;
    let patreonMemberId: string | undefined = undefined;

    if (identityData.included && identityData.included.length > 0) {
      const memberResource = identityData.included.find((item: any) => item.type === 'member');
      if (memberResource) {
        patreonMemberId = memberResource.id;
        const memberAttributes = memberResource.attributes;
        patronStatus = memberAttributes.patron_status;
        lastChargeDate = memberAttributes.last_charge_date;
        lastChargeStatus = memberAttributes.last_charge_status;
        currentTierAmountCents = memberAttributes.currently_entitled_amount_cents || 0; // null일 경우 0으로 처리

        const memberRelationships = memberResource.relationships;
        if (memberRelationships?.currently_entitled_tiers?.data?.length > 0) {
          const tierInfo = identityData.included.find(
            (item: any) => item.type === 'tier' && item.id === memberRelationships.currently_entitled_tiers.data[0].id
          );
          if (tierInfo) {
            currentTierId = tierInfo.id;
          }
        }
      }
    }

    // 3. Store Patreon data and grant points in Firestore using a batch write
    const patreonDataRef = firestoreDoc(db, PATREON_USER_DATA_COLLECTION(aronaUserId), 'data');
    
    // 기존 Patreon 사용자 데이터 가져오기 (보상 지급 여부 확인용)
    const existingPatreonDataSnap = await getDoc(patreonDataRef);
    const existingPatreonData = existingPatreonDataSnap.exists() ? existingPatreonDataSnap.data() as PatreonUserData : null;

    const patreonUserDataToStore: PatreonUserData = {
      patreonUserId: patreonUserId,
      patreonMemberId: patreonMemberId,
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresIn: expires_in,
      tokenTimestamp: Date.now(),
      scope: scope,
      tierId: currentTierId,
      lastChargeDate: lastChargeDate,
      lastChargeStatus: lastChargeStatus,
      patronStatus: patronStatus,
      // 기존 initialRewardGrantedForTierAmount 값을 유지하거나, 이번에 지급되면 업데이트
      // undefined 방지를 위해 ?? null 추가
      initialRewardGrantedForTierAmount: existingPatreonData?.initialRewardGrantedForTierAmount ?? null,
    };

    const batch = writeBatch(db);

    // Grant points based on the tier amount (only if active and not already granted for this tier amount)
    const tierAmountDollars = (currentTierAmountCents / 100).toString();
    const rewardTier = PATREON_TIER_REWARDS[tierAmountDollars];
    let pointsGrantedThisTime = 0;
    let rewardMessage = 'Patreon linked. No new tier reward granted at this time.';

    if (rewardTier && patronStatus === 'active_patron' && existingPatreonData?.initialRewardGrantedForTierAmount !== currentTierAmountCents) {
      pointsGrantedThisTime = rewardTier.points;

      // Update Point Balance
      const pointBalanceRef = firestoreDoc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(aronaUserId));
      const currentPointBalanceSnap = await getDoc(pointBalanceRef); // 배치 외부에서 읽기
      let newBalance = pointsGrantedThisTime;
      if (currentPointBalanceSnap.exists()) {
        const currentBalanceData = currentPointBalanceSnap.data() as PointBalance;
        newBalance = currentBalanceData.balance + pointsGrantedThisTime;
      }
      batch.set(pointBalanceRef, {
        userId: aronaUserId,
        balance: newBalance,
        lastUpdated: Timestamp.now().toDate(),
      }, { merge: true });

      // Create Point Transaction
      const pointTransactionColRef = collection(db, POINT_TRANSACTIONS_COLLECTION);
      const transactionId = firestoreDoc(pointTransactionColRef).id;
      const pointTransactionRef = firestoreDoc(pointTransactionColRef, transactionId);
      const transaction: PointTransaction = {
        id: transactionId,
        userId: aronaUserId,
        type: 'patreon_reward' as PointTransactionType,
        amount: pointsGrantedThisTime,
        description: `${rewardTier.name} - Patreon 최초 연동 보상 ($${tierAmountDollars})`,
        transactionDate: Timestamp.now().toDate(),
        relatedId: patreonUserId,
      };
      batch.set(pointTransactionRef, transaction);

      // 보상 지급된 티어 금액 기록
      patreonUserDataToStore.initialRewardGrantedForTierAmount = currentTierAmountCents;
      rewardMessage = `${rewardTier.name} 보상으로 ${pointsGrantedThisTime} 포인트가 지급되었습니다!`;
    } else if (rewardTier && patronStatus === 'active_patron' && existingPatreonData?.initialRewardGrantedForTierAmount === currentTierAmountCents) {
      rewardMessage = `Patreon 연동됨. ${rewardTier.name} 등급에 대한 최초 보상은 이미 지급되었습니다.`;
    } else if (patronStatus !== 'active_patron') {
      rewardMessage = `Patreon 연동됨. 현재 활성 후원 상태가 아니므로 포인트가 지급되지 않았습니다. (상태: ${patronStatus})`;
    }


    // Store/Update Patreon User Data
    batch.set(patreonDataRef, patreonUserDataToStore, { merge: true });
    
    await batch.commit();

    console.log(`Patreon callback processed for Arona User ${aronaUserId}. Patreon User ${patreonUserId}. Message: ${rewardMessage}`);

    // Redirect user to their profile page or a success page with a message
    const redirectUrl = new URL(`/profile`, process.env.NEXT_PUBLIC_BASE_URL);
    redirectUrl.searchParams.set('patreon_status', 'success');
    redirectUrl.searchParams.set('patreon_message', encodeURIComponent(rewardMessage));
    return NextResponse.redirect(redirectUrl);

  } catch (error: any) {
    console.error('Patreon callback error:', error);
    const redirectUrl = new URL(`/profile`, process.env.NEXT_PUBLIC_BASE_URL); // 오류 시에도 프로필로 리디렉션
    redirectUrl.searchParams.set('patreon_status', 'error');
    redirectUrl.searchParams.set('patreon_message', encodeURIComponent(error.message || 'An error occurred during Patreon authentication.'));
    return NextResponse.redirect(redirectUrl);
  }
}
