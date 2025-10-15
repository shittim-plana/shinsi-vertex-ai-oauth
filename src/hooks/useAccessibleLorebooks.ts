import { useState, useEffect } from 'react';
import { db } from '@/firebase/config';
import { collection, query, where, orderBy, onSnapshot, Timestamp, getDoc, doc } from 'firebase/firestore';
import { LorebookEntry } from '@/types/lorebook';

/**
 * 현재 사용자가 접근 가능한 로어북 목록(자신의 모든 로어북 + 공개된 다른 사용자의 로어북)을 가져오는 hook.
 * @param uid 현재 로그인한 사용자의 UID. null이면 로그아웃 상태로 간주.
 * @returns { lorebookEntries: LorebookEntry[], loading: boolean, error: string | null }
 */
export function useAccessibleLorebooks(uid: string | null) {
  const [lorebookEntries, setLorebookEntries] = useState<LorebookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // uid가 없으면 (로그아웃 상태 등) 로딩 종료 및 초기화
    if (!uid) {
      setLoading(false);
      setError("로그인이 필요합니다."); // 또는 null로 설정하여 에러 메시지 없이 비움
      setLorebookEntries([]);
      return;
    }

    const unsubscribes: Array<() => void> = [];
    let cancelled = false;

    const setup = async () => {
      setLoading(true);
      setError(null);

      // 권한 확인 (관리자/부관리자)
      let isPrivileged = false;
      try {
        const userDocRef = doc(db, 'users', uid);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          const u = userSnap.data() as any;
          isPrivileged = !!(u.isAdmin || u.isSubadmin);
        }
      } catch (e) {
        console.error("Error checking user roles for lorebook access:", e);
      }

      const lorebookRef = collection(db, 'lorebooks');

      if (isPrivileged) {
        // 관리자/부관리자는 모든 로어북 열람 가능
        const qAll = query(lorebookRef, orderBy('updatedAt', 'desc'));
        const unsubscribeAll = onSnapshot(
          qAll,
          (snapshot) => {
            if (cancelled) return;
            const all = snapshot.docs.map(doc => {
              const data = doc.data() as any;
              const entry: LorebookEntry = {
                id: doc.id,
                title: data.title || '',
                description: data.description || '',
                summary: data.summary || '',
                tags: data.tags || [],
                isPublic: data.isPublic || false,
                createdAt: data.createdAt instanceof Timestamp ? data.createdAt : (data.createdAt as any)?.toDate ? Timestamp.fromDate((data.createdAt as any).toDate()) : Timestamp.now(),
                updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : (data.updatedAt as any)?.toDate ? Timestamp.fromDate((data.updatedAt as any).toDate()) : Timestamp.now(),
                userId: data.userId || '',
              };
              return entry;
            });
            setLorebookEntries(all);
            setLoading(false);
          },
          (err) => {
            console.error("Error fetching all lorebook entries (admin):", err);
            setError("로어북 데이터를 불러오는 중 오류가 발생했습니다.");
            setLoading(false);
          }
        );
        unsubscribes.push(unsubscribeAll);
      } else {
        // 일반 사용자: 본인 로어북 + 공개 로어북
        let userEntriesData: LorebookEntry[] = [];
        let publicEntriesData: LorebookEntry[] = [];
        let userListenerAttached = false;
        let publicListenerAttached = false;

        const processSnapshot = () => {
          if (!userListenerAttached || !publicListenerAttached) return;

          const allEntries = [...userEntriesData, ...publicEntriesData];
          const uniqueEntriesMap = new Map<string, LorebookEntry>();

          allEntries.forEach(entry => {
            const entryData: LorebookEntry = {
                id: entry.id,
                title: entry.title || '',
                description: entry.description || '',
                summary: entry.summary || '',
                tags: entry.tags || [],
                isPublic: entry.isPublic || false,
                createdAt: entry.createdAt instanceof Timestamp ? entry.createdAt : (entry.createdAt as any)?.toDate ? Timestamp.fromDate((entry.createdAt as any).toDate()) : Timestamp.now(),
                updatedAt: entry.updatedAt instanceof Timestamp ? entry.updatedAt : (entry.updatedAt as any)?.toDate ? Timestamp.fromDate((entry.updatedAt as any).toDate()) : Timestamp.now(),
                userId: entry.userId || '',
            };

            const existingEntry = uniqueEntriesMap.get(entryData.id);
            if (!existingEntry || entryData.updatedAt.toMillis() > existingEntry.updatedAt.toMillis()) {
              uniqueEntriesMap.set(entryData.id, entryData);
            }
          });

          const combinedEntries = Array.from(uniqueEntriesMap.values())
                                 .sort((a, b) => b.updatedAt.toMillis() - a.updatedAt.toMillis());

          setLorebookEntries(combinedEntries);
          setLoading(false);
        };

        const userQueryRef = query(
          lorebookRef,
          where('userId', '==', uid),
          orderBy('updatedAt', 'desc')
        );
        const unsubscribeUser = onSnapshot(
          userQueryRef,
          (snapshot) => {
            userEntriesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LorebookEntry));
            userListenerAttached = true;
            processSnapshot();
          },
          (err) => {
            console.error("Error fetching user lorebook entries:", err);
            setError("사용자 로어북 데이터를 불러오는 중 오류가 발생했습니다.");
            setLoading(false);
            userListenerAttached = true;
            processSnapshot();
          }
        );
        unsubscribes.push(unsubscribeUser);

        const publicQueryRef = query(
          lorebookRef,
          where('isPublic', '==', true),
          orderBy('updatedAt', 'desc')
        );
        const unsubscribePublic = onSnapshot(
          publicQueryRef,
          (snapshot) => {
            publicEntriesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LorebookEntry));
            publicListenerAttached = true;
            processSnapshot();
          },
          (err) => {
            console.error("Error fetching public lorebook entries:", err);
            publicListenerAttached = true;
            processSnapshot();
          }
        );
        unsubscribes.push(unsubscribePublic);
      }
    };

    setup();

    // 컴포넌트 언마운트 시 리스너 정리
    return () => {
      cancelled = true;
      unsubscribes.forEach((fn) => {
        try { fn(); } catch {}
      });
    };
  }, [uid]); // uid가 변경될 때마다 effect 재실행

  return { lorebookEntries, loading, error };
}