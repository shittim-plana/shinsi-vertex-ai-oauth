import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';
import { RedemptionCode, RedemptionCodeStatus } from '@/types/point';

const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY;
const REDEMPTION_CODES_COLLECTION = 'redemptionCodes';

export async function POST(req: NextRequest) {
  // 1. 관리자 인증
  const providedSecret = req.headers.get('Authorization')?.split(' ')[1];
  if (!ADMIN_SECRET_KEY || providedSecret !== ADMIN_SECRET_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { email, points, description } = await req.json();

    if (!email || !points) {
      return NextResponse.json({ error: 'User email and points are required.' }, { status: 400 });
    }

    // 2. 고유 코드 생성
    const code = `MANUAL-${uuidv4().toUpperCase().substring(0, 13)}`;

    // 3. Firestore에 저장할 코드 객체 생성
    const newCode: RedemptionCode = {
      code,
      pointsValue: Number(points),
      status: RedemptionCodeStatus.Unused,
      patronEmail: email, // 수동 발급에서는 이메일을 직접 지정
      createdAt: Timestamp.now(),
      tierId: 'manual', // 수동 발급임을 명시
      description: description || `Manually issued coupon for ${email}`,
    };

    // 4. Firestore에 코드 저장
    const docRef = await addDoc(collection(db, REDEMPTION_CODES_COLLECTION), newCode);

    console.log(`Manual redemption code created for ${email} with ID: ${docRef.id}`);

    // 5. 생성된 코드 정보 반환
    return NextResponse.json({
      message: 'Coupon issued successfully.',
      coupon: {
        code: newCode.code,
        points: newCode.pointsValue,
        email: newCode.patronEmail,
      },
    }, { status: 201 });

  } catch (error: any) {
    console.error('Error issuing manual coupon:', error);
    return NextResponse.json({ error: 'Failed to issue coupon.' }, { status: 500 });
  }
}