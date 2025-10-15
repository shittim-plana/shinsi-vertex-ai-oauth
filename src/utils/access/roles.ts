import { db } from '@/firebase/config';
import { doc, getDoc } from 'firebase/firestore';

export type UserRoles = {
  isAdmin: boolean;
  isSubadmin: boolean;
};

export async function getUserRoles(uid: string | null): Promise<UserRoles> {
  if (!uid) {
    return { isAdmin: false, isSubadmin: false };
  }
  try {
    const userRef = doc(db, 'users', uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data() as any;
      return {
        isAdmin: data?.isAdmin === true,
        isSubadmin: data?.isSubadmin === true,
      };
    }
  } catch (e) {
    console.error('[access/roles] getUserRoles failed:', e);
  }
  return { isAdmin: false, isSubadmin: false };
}

export function isPrivileged(roles: UserRoles): boolean {
  return Boolean(roles?.isAdmin || roles?.isSubadmin);
}