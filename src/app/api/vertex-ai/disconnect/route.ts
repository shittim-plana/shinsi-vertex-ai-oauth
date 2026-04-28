import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, getDoc, updateDoc, deleteField } from 'firebase/firestore';
import { GOOGLE_REVOKE_ENDPOINT } from '@/utils/vertex-ai/constants';

export async function POST(req: NextRequest) {
  let body: { uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { uid } = body;
  if (!uid) {
    return NextResponse.json({ error: 'uid is required.' }, { status: 400 });
  }

  try {
    const userDocRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    }

    const data = userDoc.data();
    const refreshToken = data?.vertexAI?.refreshToken as string | undefined;
    const accessToken = data?.vertexAI?.accessToken as string | undefined;

    // Revoke tokens at Google (best-effort).
    // Revoking the refresh token invalidates all associated access tokens.
    // Additionally revoke the current access token (ref: lib/vertex-ai-oauth.js signOut()).
    const revokeToken = async (token: string): Promise<void> => {
      const res = await fetch(`${GOOGLE_REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        throw new Error(`Revoke endpoint returned ${res.status}: ${errBody}`);
      }
    };

    if (refreshToken) {
      try {
        await revokeToken(refreshToken);
      } catch (revokeError: unknown) {
        const msg = revokeError instanceof Error ? revokeError.message : String(revokeError);
        console.warn(`[VertexAI Disconnect] Refresh token revoke failed for user ${uid}: ${msg}`);
      }
    }

    if (accessToken) {
      try {
        await revokeToken(accessToken);
      } catch (revokeError: unknown) {
        const msg = revokeError instanceof Error ? revokeError.message : String(revokeError);
        console.warn(`[VertexAI Disconnect] Access token revoke failed for user ${uid}: ${msg}`);
      }
    }

    // Remove vertexAI field from Firestore
    await updateDoc(userDocRef, { vertexAI: deleteField() });

    console.log(`[VertexAI Disconnect] Disconnected for user ${uid}`);
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VertexAI Disconnect] Error for user ${uid}: ${errMsg}`);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
