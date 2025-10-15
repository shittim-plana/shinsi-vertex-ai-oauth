import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { db } from '@/firebase/config';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { PatreonWebhookPayload, PatreonApiUser } from '@/types/patreon';
import { RedemptionCode, RedemptionCodeStatus } from '@/types/point';

// 타입 가드: 객체가 PatreonApiUser 타입인지 확인
function isPatreonApiUser(item: any): item is PatreonApiUser {
  return item && item.type === 'user';
}

const PATREON_WEBHOOK_SECRET = process.env.PATREON_WEBHOOK_SECRET;
const REDEMPTION_CODES_COLLECTION = 'redemptionCodes';

// 후원 등급에 따른 포인트 매핑 (예시)
const tierToPoints: { [key: string]: number } = {
  'tier-1-id': 1000, // 실제 Patreon 티어 ID로 교체해야 합니다.
  'tier-2-id': 2500,
  'tier-3-id': 5000,
};

export async function POST(req: NextRequest) {
  if (!PATREON_WEBHOOK_SECRET) {
    console.error('Patreon webhook secret is not configured.');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  try {
    const signature = req.headers.get('X-Patreon-Signature');
    const payload = await req.text();

    // 1. Webhook 시그니처 검증
    const hmac = crypto.createHmac('md5', PATREON_WEBHOOK_SECRET);
    hmac.update(payload);
    const digest = hmac.digest('hex');

    if (digest !== signature) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const webhookData: PatreonWebhookPayload = JSON.parse(payload);
    const eventType = req.headers.get('X-Patreon-Event');

    // 2. 신규 후원 또는 등급 변경 이벤트 처리
    if (eventType === 'pledges:create' || eventType === 'pledges:update') {
      const { data, included } = webhookData;
      const user = included?.find(isPatreonApiUser);
      const userEmail = user?.attributes.email;
      const tierData = data.relationships?.currently_entitled_tiers?.data[0];

      if (!userEmail || !tierData) {
        return NextResponse.json({ error: 'Missing user email or tier data in webhook.' }, { status: 400 });
      }

      const points = tierToPoints[tierData.id];
      if (!points) {
        console.warn(`No points configured for tier ID: ${tierData.id}`);
        return NextResponse.json({ message: 'Pledge received, but no action taken for this tier.' }, { status: 200 });
      }

      // 3. 고유 코드 생성
      const code = `PATREON-${uuidv4().toUpperCase().substring(0, 13)}`;

      // 4. Firestore에 코드 저장
      const newCode: RedemptionCode = {
        code,
        pointsValue: points,
        status: RedemptionCodeStatus.Unused,
        patronEmail: userEmail,
        createdAt: Timestamp.now(),
        tierId: tierData.id,
        description: `Patreon reward for tier ${tierData.id}`,
      };

      await addDoc(collection(db, REDEMPTION_CODES_COLLECTION), newCode);

      console.log(`Redemption code created for ${userEmail} for tier ${tierData.id}`);
      
      // TODO: 사용자에게 이메일로 코드 발송 로직 추가
    }

    return NextResponse.json({ status: 'success' }, { status: 200 });

  } catch (error: any) {
    console.error('Error processing Patreon webhook:', error);
    return NextResponse.json({ error: 'Failed to process webhook.' }, { status: 500 });
  }
}