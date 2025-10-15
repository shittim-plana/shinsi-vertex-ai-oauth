import { NextRequest, NextResponse } from 'next/server';
import { adminApp } from '@/firebase/firebaseAdmin';
import { getAuth, UserRecord } from 'firebase-admin/auth';
import { cookies } from 'next/headers';
import {
  cancelStripeSubscriptionsForUser,
  revokePatreonTokens,
  deleteFirestoreUserData,
  deleteStorageAssetsByUser,
  deleteSupabaseVectorsByUser,
  deleteUserAccount,
  collectUserRoomIds
} from '@/utils/user-delete';

// Firebase Admin Auth 인스턴스
const auth = getAuth(adminApp);

/**
 * 사용자 인증 및 UID 추출
 */
async function authenticateUser(req: NextRequest): Promise<{ uid: string; user: UserRecord } | { error: string; status: number }> {
  // 1. Authorization 헤더에서 ID 토큰 확인
  const token = req.headers.get('Authorization')?.split('Bearer ')[1];
  if (token) {
    try {
      const decodedToken = await auth.verifyIdToken(token);
      const user = await auth.getUser(decodedToken.uid);
      return { uid: decodedToken.uid, user };
    } catch (error: any) {
      return { error: 'Invalid or expired token', status: 401 };
    }
  }

  // 2. 쿠키에서 UID 확인
  const cookieStore = await cookies();
  const uid = cookieStore.get('uid')?.value;
  if (uid) {
    try {
      const user = await auth.getUser(uid);
      return { uid, user };
    } catch (error: any) {
      return { error: 'Invalid UID in cookie', status: 401 };
    }
  }

  return { error: 'Authentication required', status: 401 };
}

/**
 * 회원탈퇴 API 엔드포인트
 * POST /api/user/delete
 */
export async function POST(req: NextRequest) {
  const steps: Array<{ step: string; success: boolean; details: string[]; duration?: number }> = [];
  const allErrors: string[] = [];
  let startTime = Date.now();

  try {
    // 1. 사용자 인증
    const authResult = await authenticateUser(req);
    if ('error' in authResult) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const { uid, user } = authResult;
    steps.push({
      step: 'authentication',
      success: true,
      details: [`사용자 인증 완료: ${user.email || uid}`],
      duration: Date.now() - startTime
    });

    startTime = Date.now();

    // 2. Stripe 구독 취소
    const stripeResult = await cancelStripeSubscriptionsForUser(uid);
    steps.push({
      step: 'stripe_cancel',
      success: stripeResult.success,
      details: stripeResult.details,
      duration: Date.now() - startTime
    });
    if (!stripeResult.success) {
      allErrors.push(...stripeResult.details);
    }

    startTime = Date.now();

    // 3. Patreon 토큰 철회
    const patreonResult = await revokePatreonTokens(uid);
    steps.push({
      step: 'patreon_revoke',
      success: patreonResult.success,
      details: patreonResult.details,
      duration: Date.now() - startTime
    });
    if (!patreonResult.success) {
      allErrors.push(...patreonResult.details);
    }

    startTime = Date.now();

    // 4. Firestore 데이터 삭제
    const firestoreResult = await deleteFirestoreUserData(uid);
    steps.push({
      step: 'firestore_delete',
      success: firestoreResult.success,
      details: firestoreResult.details,
      duration: Date.now() - startTime
    });
    if (!firestoreResult.success) {
      allErrors.push(...firestoreResult.details);
    }

    startTime = Date.now();

    // 5. Storage 자산 삭제
    const storageResult = await deleteStorageAssetsByUser(uid);
    steps.push({
      step: 'storage_delete',
      success: storageResult.success,
      details: storageResult.details,
      duration: Date.now() - startTime
    });
    if (!storageResult.success) {
      allErrors.push(...storageResult.details);
    }

    startTime = Date.now();

    // 6. Supabase 벡터 데이터 삭제
    const supabaseResult = await deleteSupabaseVectorsByUser(uid, firestoreResult.roomIds);
    steps.push({
      step: 'supabase_delete',
      success: supabaseResult.success,
      details: supabaseResult.details,
      duration: Date.now() - startTime
    });
    if (!supabaseResult.success) {
      allErrors.push(...supabaseResult.details);
    }

    startTime = Date.now();

    // 7. Firebase Auth 사용자 삭제 (마지막 단계)
    const authDeleteResult = await deleteUserAccount(uid);
    steps.push({
      step: 'auth_delete',
      success: authDeleteResult.success,
      details: authDeleteResult.details,
      duration: Date.now() - startTime
    });
    if (!authDeleteResult.success) {
      allErrors.push(...authDeleteResult.details);
    }

    // 결과 요약
    const totalSteps = steps.length;
    const successfulSteps = steps.filter(s => s.success).length;
    const failedSteps = totalSteps - successfulSteps;

    const response = {
      status: failedSteps === 0 ? 'ok' : 'partial',
      summary: {
        totalSteps,
        successfulSteps,
        failedSteps,
        totalDuration: steps.reduce((sum, s) => sum + (s.duration || 0), 0)
      },
      details: {
        steps: steps.map(s => ({
          step: s.step,
          success: s.success,
          details: s.details,
          duration: s.duration
        })),
        errors: allErrors
      }
    };

    // 데이터 삭제가 완료되었으면 200, 그렇지 않으면 207 (Partial Content)
    const statusCode = failedSteps === 0 ? 200 : 207;

    return NextResponse.json(response, { status: statusCode });

  } catch (error: any) {
    console.error('회원탈퇴 처리 중 오류 발생:', error);

    // 예상치 못한 오류 발생 시에도 진행된 단계는 기록
    const errorResponse = {
      status: 'error',
      summary: {
        totalSteps: steps.length,
        successfulSteps: steps.filter(s => s.success).length,
        failedSteps: steps.filter(s => !s.success).length + 1, // 현재 오류 포함
        totalDuration: steps.reduce((sum, s) => sum + (s.duration || 0), 0)
      },
      details: {
        steps,
        errors: [...allErrors, `예상치 못한 오류: ${error.message}`]
      }
    };

    return NextResponse.json(errorResponse, { status: 500 });
  }
}