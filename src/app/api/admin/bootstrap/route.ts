import { NextRequest, NextResponse } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { adminApp } from '@/firebase/firebaseAdmin';
import { db } from '@/firebase/config';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Admin bootstrap endpoint to grant admin role to a fixed email.
 * - References existing admin usage pattern (see Patreon callback) to get Admin Auth.
 * - Updates Firestore users/{uid} document with isAdmin: true (and isSubadmin: false).
 * - Optionally sets custom claims (not required by the app, but useful for auditing).
 *
 * Security:
 * - Requires Authorization: Bearer <ADMIN_BOOTSTRAP_TOKEN> header to run.
 *   Set process.env.ADMIN_BOOTSTRAP_TOKEN on the server before invoking.
 *
 * Usage example (PowerShell / curl):
 *   curl -X POST ^
 *     -H "Authorization: Bearer YOUR_SECRET_TOKEN" ^
 *     https://<your-domain>/api/admin/bootstrap
 */
const getAdminAuth = () => {
  if (!adminApp) {
    throw new Error('Firebase Admin App not initialized. Check firebaseAdmin.ts.');
  }
  return getAuth(adminApp);
};

// Target email to promote
const TARGET_EMAIL = 'bak405@gmail.com';

export async function POST(req: NextRequest) {
  try {
    // Validate bootstrap token
    const expectedToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
    const authHeader = req.headers.get('authorization') || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

    if (!expectedToken) {
      console.error('[bootstrap] ADMIN_BOOTSTRAP_TOKEN is not set on server');
      return NextResponse.json({ error: 'Server not configured for bootstrap.' }, { status: 500 });
    }
    if (!provided || provided !== expectedToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const adminAuth = getAdminAuth();

    // Find user by email
    let uid: string;
    let displayName: string | null = null;
    try {
      const record = await adminAuth.getUserByEmail(TARGET_EMAIL);
      uid = record.uid;
      displayName = record.displayName || null;
    } catch (e: any) {
      console.error(`[bootstrap] User not found by email: ${TARGET_EMAIL}`, e?.message || e);
      return NextResponse.json({ error: `User with email ${TARGET_EMAIL} not found` }, { status: 404 });
    }

    // Update Firestore users/{uid}
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    const base = {
      uid,
      email: TARGET_EMAIL,
      displayName: displayName || '관리자',
      rolesUpdatedAt: serverTimestamp(),
      rolesUpdatedBy: 'bootstrap',
      isAdmin: true,
      isSubadmin: false,
    };

    if (snap.exists()) {
      await setDoc(userRef, base, { merge: true });
    } else {
      await setDoc(
        userRef,
        {
          ...base,
          createdAt: serverTimestamp(),
          recentChats: [],
          membershipTier: 'none',
          settings: {
            theme: 'light',
            notifications: true,
            memoryCapacity: 25,
            enableImageGeneration: false,
            enableNSFW: true,
            aiModel: 'gemini-2.5-flash-preview-04-17',
          },
        },
        { merge: true }
      );
    }

    // Optional: set custom claims (app checks Firestore, but adding claims can help audits)
    try {
      await adminAuth.setCustomUserClaims(uid, { isAdmin: true, isSubadmin: false });
    } catch (claimsErr) {
      console.warn('[bootstrap] setCustomUserClaims failed (non-fatal):', claimsErr);
    }

    return NextResponse.json({
      success: true,
      message: `Granted admin to ${TARGET_EMAIL}`,
      uid,
    });
  } catch (error: any) {
    console.error('[bootstrap] error:', error?.message || error);
    return NextResponse.json({ error: 'Bootstrap failed' }, { status: 500 });
  }
}