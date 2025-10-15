/**
 * src/firebase/firebaseAdmin.ts
 * - Next.js dev 환경의 HMR에서도 안전하게 동작하도록 getApp()/getApps() 패턴을 사용
 * - firebase-admin/app의 cert/initializeApp/getApp 를 사용해 내부 namespace 의존성을 회피
 */
import { initializeApp, getApps, getApp, App, cert } from 'firebase-admin/app';

let adminApp: App;

if (!getApps().length) {
  try {
    const serviceAccountConfig = process.env.FIREBASE_ADMIN_SDK_CONFIG;
    if (!serviceAccountConfig) {
      const errorMessage =
        'Firebase Admin SDK initialization failed: FIREBASE_ADMIN_SDK_CONFIG environment variable is not set. Please provide the service account JSON content as the value for this variable.';
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    const serviceAccount = JSON.parse(serviceAccountConfig);

    adminApp = initializeApp({
      credential: cert(serviceAccount),
    });

    console.log('Firebase Admin SDK initialized successfully via environment variable.');
  } catch (error: any) {
    console.error('An error occurred during Firebase Admin SDK initialization:', error?.message || error);
    throw new Error(`Firebase Admin SDK initialization failed. Original error: ${error?.message || error}`);
  }
} else {
  // 재시작/핫리로드 시 이미 초기화된 앱을 재사용
  adminApp = getApp();
}

export { adminApp };
