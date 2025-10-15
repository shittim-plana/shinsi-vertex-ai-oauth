'use client';

import { useState, useEffect, useMemo, useCallback } from 'react'; // Added useMemo, useCallback
import { Container, Title, Paper, Avatar, Text, Group, Button, Tabs, Stack, Divider, TextInput, PasswordInput, Slider, Select, Loader, NumberInput, Switch, Grid, Table, Badge, Anchor } from '@mantine/core'; // Added Loader, NumberInput, Switch, Grid, Table, Badge, Anchor
// Removed duplicate import on line 5
import { useRouter } from 'next/navigation';
import Cookies from 'js-cookie'; // js-cookie import 추가
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { usePublicCharacters } from '@/hooks/usePublicCharacters';
import { AppShell } from '@/components/layout/AppShell';
import { db, storage, auth, patreonUserDataDoc } from '@/firebase/config'; // auth 추가, patreonUserDataDoc 추가
import { doc, getDoc, updateDoc, collection, query, where, getDocs, deleteDoc, orderBy, limit, startAfter } from 'firebase/firestore'; // deleteDoc 추가, pagination/ordering 추가
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { getProxiedStorageUrl } from '@/utils/storage-utils';
import { updateProfile, EmailAuthProvider, reauthenticateWithCredential, updatePassword, linkWithCredential } from 'firebase/auth';
import { IconUser, IconLock, IconPhoto, IconSettings, IconUserPlus, IconRobot, IconLink, IconUnlink, IconBrandPatreon, IconChartBar, IconCoin } from '@tabler/icons-react'; // IconLink, IconUnlink, IconBrandPatreon 추가, 통계 아이콘 추가
import { Character } from '@/types/character';
import { PatreonUserData } from '@/types/patreon'; // PatreonUserData 타입 추가
import { characterFromDoc } from '@/utils/firestoreUtils'; // Import the utility function
import { filterActiveCharacters } from '@/utils/character-utils';
import { AttendanceCard } from '@/components/attendance/AttendanceCard';
// Removed local Character interface definition

export default function ProfilePage() {
  const [loading, setLoading] = useState(false);
  const [imageUpload, setImageUpload] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const { user, logOut, uid, token } = useAuth();
  const { settings, updateSettings, membershipTier } = useSettings();
  const router = useRouter();
  const [userCharacters, setUserCharacters] = useState<Character[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const [personaLoading, setPersonaLoading] = useState(false);
  const [personaSearchTerm, setPersonaSearchTerm] = useState('');
  const [patreonData, setPatreonData] = useState<PatreonUserData | null>(null);
  const [patreonLoading, setPatreonLoading] = useState(false);
  const [patreonLinkEmail, setPatreonLinkEmail] = useState(user?.email || ''); // Patreon 연동용 이메일 상태
  const { publicCharacters, loading: loadingPublicCharacters, error: publicCharactersError } = usePublicCharacters();

  // --- Points/Statistics state ---
  type Tx = {
    id: string;
    userId: string;
    type: string;
    amount: number;
    description: string;
    transactionDate: Date;
    relatedId?: string;
  };

  const [txLoading, setTxLoading] = useState(false);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [txCursor, setTxCursor] = useState<any>(null);
  const [txHasMore, setTxHasMore] = useState(true);
  const [txTotalCount, setTxTotalCount] = useState<number | null>(null);
  const [txError, setTxError] = useState<string | null>(null);

  const [spentTotal, setSpentTotal] = useState(0);
  const [earnedTotal, setEarnedTotal] = useState(0);
  const [netTotal, setNetTotal] = useState(0);

  useEffect(() => {
    // user 객체가 로드되거나 변경될 때 patreonLinkEmail 초기값 설정
    if (user && !patreonLinkEmail) {
      setPatreonLinkEmail(user.email || '');
    }
  }, [user, patreonLinkEmail]);

  const handlePatreonLink = () => {
    if (!patreonLinkEmail.trim()) {
      notifications.show({
        title: '이메일 필요',
        message: 'Patreon 연동에 사용할 이메일 주소를 입력해주세요.',
        color: 'yellow',
      });
      return;
    }
    // Patreon 연동 API 라우트로 리디렉션 (email 파라미터 사용)
    router.push(`/api/patreon/auth?email=${encodeURIComponent(patreonLinkEmail)}`);
  };

  const handlePatreonUnlink = async () => {
    if (!uid || !patreonData?.patreonUserId) {
      notifications.show({
        title: '오류',
        message: 'Patreon 연동 정보를 찾을 수 없습니다.',
        color: 'red',
      });
      return;
    }
    setPatreonLoading(true);
    try {
      // Firestore에서 Patreon 데이터 삭제
      // users/{aronaUserId}/patreonData/{patreonUserId} 문서 삭제
      const docRef = patreonUserDataDoc(uid, patreonData.patreonUserId);
      await deleteDoc(docRef);

      // TODO: 관련된 포인트 및 혜택을 조정하는 로직 추가 필요
      // 예를 들어, 활성 티어 정보를 사용자 문서에서 제거하고, 관련 포인트 기록을 남길 수 있습니다.
      // const userProfileRef = doc(db, 'users', uid);
      // await updateDoc(userProfileRef, { activePatreonTier: null, patreonBenefits: {} });

      setPatreonData(null);
      notifications.show({
        title: 'Patreon 연동 해제됨',
        message: 'Patreon 연동 정보가 삭제되었습니다. 실제 구독은 Patreon에서 관리해야 합니다.',
        color: 'orange',
      });
    } catch (error) {
      console.error("Patreon 연동 해제 에러:", error);
      notifications.show({
        title: 'Patreon 연동 해제 실패',
        message: '연동 해제 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPatreonLoading(false);
    }
  };

  const fetchPatreonData = useCallback(async (currentUid: string) => {
    if (!currentUid) return;
    setPatreonLoading(true);
    try {
      // Patreon 데이터는 여러 개일 수 있으므로, 가장 최근 또는 활성 상태인 것을 찾아야 할 수 있습니다.
      // 여기서는 간단히 첫 번째 문서를 가져옵니다. 실제로는 patreonUserId로 특정 문서를 찾아야 합니다.
      // OAuth 콜백에서 patreonUserId를 저장했다면, 그 ID를 사용해야 합니다.
      // 지금은 사용자의 patreonData 서브컬렉션에 하나의 문서만 있다고 가정합니다.
      const patreonDataColRef = collection(db, `users/${currentUid}/patreonData`);
      const patreonDataSnapshot = await getDocs(patreonDataColRef);
      if (!patreonDataSnapshot.empty) {
        // 여러 연동 정보가 있을 경우, 가장 유효한 것을 선택하는 로직 필요
        const firstPatreonDoc = patreonDataSnapshot.docs[0];
        setPatreonData(firstPatreonDoc.data() as PatreonUserData);
      } else {
        setPatreonData(null);
      }
    } catch (error) {
      console.error("Patreon 데이터 로딩 에러:", error);
      notifications.show({
        title: 'Patreon 정보 로딩 실패',
        message: 'Patreon 연동 정보를 불러오는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPatreonLoading(false);
    }
  }, [notifications]);


  const fetchUserData = useCallback(async () => {
    const uidFromCookie = uid;
    if (!uidFromCookie) return;
    setPersonaLoading(true);
    fetchPatreonData(uidFromCookie); // Patreon 데이터도 함께 로드
    try {
      const charactersRef = collection(db, 'characters');

      // Fetch all of the user's characters (public and private)
      const userCharactersQuery = query(
        charactersRef,
        where('creatorId', '==', uidFromCookie), // 쿠키 uid 사용
        where('isDeleted', '==', false)
        // No isPublic filter here, fetch all
      );
      const userCharactersSnapshot = await getDocs(userCharactersQuery);
      const userCharactersList: Character[] = [];
      userCharactersSnapshot.forEach((doc) => {
        const character = characterFromDoc(doc);
        if (character) {
          userCharactersList.push(character);
        } else {
          console.warn("Failed to parse user character document:", doc.id);
        }
      });

      // --- Fetch selected persona ID ---
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      const userDocSnap = await getDoc(userDocRef);

      let currentSelectedPersonaId: string | null = null;

      if (userDocSnap.exists()) {
        const userData = userDocSnap.data();
        currentSelectedPersonaId = userData.selectedPersonaId || null;
      }
      // --- End fetching selected persona ID ---

      // Update states
      setUserCharacters(filterActiveCharacters(userCharactersList));
      setSelectedPersonaId(currentSelectedPersonaId);

    } catch (error) {
      console.error('사용자 데이터 로딩 에러:', error);
      notifications.show({
        title: '데이터 로딩 실패',
        message: '캐릭터 또는 설정 정보를 불러오는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPersonaLoading(false);
    }
  }, [uid, fetchPatreonData, notifications]);

  // Profile update form
  const profileForm = useForm({
    initialValues: {
      displayName: user?.displayName || '',
      email: user?.email || '',
    },
    validate: {
      displayName: (value) => (value.trim().length > 0 ? null : '이름을 입력해주세요'),
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '유효한 이메일을 입력해주세요'),
    },
  });

  // 만약 사용자가 로그인하지 않았다면 로그인 페이지로 리디렉션 (쿠키 확인)
  useEffect(() => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
      router.push('/login');
    } else if (user) { // user 객체가 로드된 후 실행
      // Set preview to current user photo if exists
      if (user.photoURL) {
        // Use the proxied URL and add timestamp to prevent caching
        setImagePreview(`${getProxiedStorageUrl(user.photoURL)}?t=${Date.now()}`);
      }
      // Initialize form with user data
      profileForm.setValues({
        displayName: user.displayName || '익명 사용자',
        email: user.email || '',
      });

      // Fetch user characters and selected persona
      fetchUserData();
    }
  }, [user, router, fetchUserData]); // Removed profileForm from dependencies

  // Handle persona selection change
  const handlePersonaChange = async (value: string | null) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) return;
    setPersonaLoading(true);
    try {
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      await updateDoc(userDocRef, {
        selectedPersonaId: value // Store null if 'None' is selected
      });
      setSelectedPersonaId(value);
      // Find character name from combined list (user's private + all public) for notification
      const myPrivateChars = userCharacters.filter(char => !char.isPublic);
      // Use a Map to combine and deduplicate public characters and user's private characters
      const combinedCharsMap = new Map<string, Character>();
      publicCharacters.forEach(char => combinedCharsMap.set(char.id, char)); // Add all public first
      myPrivateChars.forEach(char => combinedCharsMap.set(char.id, char)); // Add user's private (overwrites if ID conflict, unlikely)
      const allAvailableChars = Array.from(combinedCharsMap.values());

      const selectedCharName = allAvailableChars.find(c => c.id === value)?.name;

      notifications.show({
        title: '페르소나 변경 완료',
        message: value ? `페르소나가 ${selectedCharName || '알 수 없는 캐릭터'}(으)로 설정되었습니다.` : '페르소나 설정이 해제되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('페르소나 업데이트 에러:', error);
      notifications.show({
        title: '페르소나 변경 실패',
        message: '페르소나 설정 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPersonaLoading(false);
    }
  };

  // Password update form
  const passwordForm = useForm({
    initialValues: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    validate: {
      currentPassword: (value) => (value.length >= 6 ? null : '비밀번호는 최소 6자 이상이어야 합니다'),
      newPassword: (value) => (value.length >= 6 ? null : '비밀번호는 최소 6자 이상이어야 합니다'),
      confirmPassword: (value, values) =>
        value === values.newPassword ? null : '비밀번호가 일치하지 않습니다',
    },
  });

  // Convert anonymous account form
  const convertAccountForm = useForm({
    initialValues: {
      email: '',
      password: '',
      confirmPassword: '',
    },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '유효한 이메일을 입력해주세요'),
      password: (value) => (value.length >= 6 ? null : '비밀번호는 최소 6자 이상이어야 합니다'),
      confirmPassword: (value, values) =>
        value === values.password ? null : '비밀번호가 일치하지 않습니다',
    },
  });

  // Handle image change
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (file) {
      setImageUpload(file);
      const fileReader = new FileReader();
      fileReader.onload = () => {
        setImagePreview(fileReader.result as string);
      };
      fileReader.readAsDataURL(file);
    }
  };

  // Handle profile update
  const updateUserProfile = async (values: typeof profileForm.values) => {
    const uidFromCookie = uid;
    if (!uidFromCookie || !user) return;

    // 익명 로그인 사용자는 프로필 업데이트를 제한합니다.
    if (user.isAnonymous || user.providerData.some(provider => provider.providerId === 'anonymous')) {
      notifications.show({
        title: '프로필 업데이트 제한',
        message: '익명 로그인 사용자는 프로필을 업데이트할 수 없습니다.',
        color: 'red',
      });
      return;
    }

    setLoading(true);
    try {
      let photoURL = user.photoURL || '';

      // Upload new profile picture if one was selected
      if (imageUpload) {
        const storageRef = ref(storage, `users/${uidFromCookie}/profile`); // 쿠키 uid 사용
        await uploadBytes(storageRef, imageUpload);

        // Get direct URL from Firebase Storage (always store the direct URL)
        const directURL = await getDownloadURL(storageRef);
        photoURL = directURL;
      }
      
      // Update profile in Firebase Auth
      if (auth.currentUser) { // auth.currentUser null 체크 추가
        await updateProfile(auth.currentUser, { // auth.currentUser 사용
          displayName: values.displayName,
          photoURL: photoURL,
        });
      } else {
        throw new Error("User not authenticated"); // 사용자가 인증되지 않은 경우 오류 발생
      }
      
      // Update profile in Firestore
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        await updateDoc(userDocRef, {
          displayName: values.displayName,
          photoURL: photoURL,
        });
      }
      
      // Update image preview with timestamp to prevent caching (proxy in dev)
      setImagePreview(`${getProxiedStorageUrl(photoURL)}?t=${Date.now()}`);

      notifications.show({
        title: '프로필 업데이트 성공',
        message: '프로필이 성공적으로 업데이트되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('프로필 업데이트 에러:', error);
      notifications.show({
        title: '프로필 업데이트 실패',
        message: '프로필 업데이트 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle anonymous account conversion
  const convertAnonymousAccount = async (values: typeof convertAccountForm.values) => {
    const uidFromCookie = uid;
    // user 객체도 확인 (linkWithCredential, updateProfile 위해)
    if (!uidFromCookie || !user || !user.isAnonymous) return;

    setLoading(true);
    try {
      // Create credential with email and password
      const credential = EmailAuthProvider.credential(
        values.email,
        values.password
      );
      
      // Link anonymous account with credential
      await linkWithCredential(user, credential);
      
      // Update profile in Firebase Auth
      await updateProfile(user, {
        displayName: user.displayName || '사용자',
      });
      
      // Update user document in Firestore
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        await updateDoc(userDocRef, {
          email: values.email,
          authProvider: 'email',
          isAnonymous: false,
        });
      }
      
      notifications.show({
        title: '계정 전환 성공',
        message: '익명 계정이 정식 계정으로 전환되었습니다.',
        color: 'green',
      });
      
      // Reload page to reflect changes
      window.location.reload();
    } catch (error) {
      console.error('계정 전환 에러:', error);
      notifications.show({
        title: '계정 전환 실패',
        message: '이미 사용 중인 이메일이거나 다른 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle password update
  const updateUserPassword = async (values: typeof passwordForm.values) => {
    // auth.currentUser 사용 및 null 체크 추가
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) {
      notifications.show({
        title: '오류',
        message: '사용자 인증 정보를 찾을 수 없습니다.',
        color: 'red',
      });
      return;
    }
    
    setLoading(true);
    try {
      // Re-authenticate user
      const credential = EmailAuthProvider.credential(
        currentUser.email, // currentUser.email 사용
        values.currentPassword
      );
      
      await reauthenticateWithCredential(currentUser, credential); // currentUser 사용
      
      // Update password
      await updatePassword(currentUser, values.newPassword); // currentUser 사용
      
      passwordForm.reset();
      
      notifications.show({
        title: '비밀번호 변경 성공',
        message: '비밀번호가 성공적으로 변경되었습니다.',
        color: 'green',
      });
    } catch (error) {
      console.error('비밀번호 변경 에러:', error);
      notifications.show({
        title: '비밀번호 변경 실패',
        message: '현재 비밀번호가 올바르지 않거나 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    try {
      await logOut();
      router.push('/login');
    } catch (error) {
      console.error('로그아웃 오류:', error);
    }
  };

  // Effect to validate selectedPersonaId when relevant data changes
  useEffect(() => {
    if (!selectedPersonaId) return; // No need to validate if nothing is selected

    // Check if the selected ID exists in the user's private characters or any public characters
    const isOwnPrivateCharacter = userCharacters.some(char => char.id === selectedPersonaId && !char.isPublic);
    const isPublicCharacter = publicCharacters.some(char => char.id === selectedPersonaId); // Already filtered for isPublic in the hook

    if (!isOwnPrivateCharacter && !isPublicCharacter) {
      console.warn(`Selected persona ${selectedPersonaId} is no longer valid (not own private or public). Resetting.`);
      setSelectedPersonaId(null);
      // Optionally update Firestore
      // const uidFromCookie = uid;
      // if (uidFromCookie) {
      //   const userDocRef = doc(db, 'users', uidFromCookie);
      //   updateDoc(userDocRef, { selectedPersonaId: null }).catch(err => console.error("Error resetting persona in Firestore:", err));
      // }
    }
    // Depend on userCharacters (own) and publicCharacters
    }, [selectedPersonaId, userCharacters, publicCharacters]); // user 의존성 제거 (uid는 쿠키에서)

  // --- useMemo for Persona Select Data ---
  const personaSelectData = useMemo(() => {
    // Group 1: User's private characters
    const myPrivateChars = userCharacters
      .filter(char => !char.isPublic)
      .map(char => ({ value: char.id, label: char.name }));

    // Group 2: All public characters (including user's own public)
    const publicCharsMap = new Map(publicCharacters.map(char => [char.id, char]));
    const publicCharItems = Array.from(publicCharsMap.values())
                              .map(char => ({
                                value: char.id,
                                // Label: Add (Owner) if it's user's own public character
                                label: char.creatorId === uid ? `${char.name} (내 공개 캐릭터)` : `${char.name} (공개)` // 쿠키 uid 사용
                              }));


  const baseData = [
      { group: '기본', items: [{ value: '', label: '없음 (기본)' }] },
      { group: '내 비공개 캐릭터', items: myPrivateChars }, // Group for user's private characters
      { group: '공개 캐릭터', items: publicCharItems } // Group for all public characters
    ].filter(group => group.items.length > 0); // Remove empty groups (e.g., if user has no private chars)

    // Apply client-side search filtering based on personaSearchTerm
    if (!personaSearchTerm.trim()) {
      return baseData; // Return all groups if no search term
    }
    const searchTermLower = personaSearchTerm.toLowerCase();
    // Filter items within each group, then filter out groups that become empty
    return baseData.map(group => ({
      ...group,
      items: group.items.filter(item => item.label.toLowerCase().includes(searchTermLower))
    })).filter(group => group.items.length > 0);

  }, [userCharacters, publicCharacters, personaSearchTerm]); // user 의존성 제거 (uid는 쿠키에서)




  // --- load user point transactions ---
  const fetchTransactions = useCallback(async (reset = false) => {
    const currentUid = uid;
    if (!currentUid) return;
    if (txLoading) return;

    setTxError(null);
    setTxLoading(true);
    try {
      const colRef = collection(db, 'pointTransactions');
      const baseQuery = query(
        colRef,
        where('userId', '==', currentUid),
        orderBy('transactionDate', 'desc'),
        limit(20)
      );

      const q = reset || !txCursor ? baseQuery : query(
        colRef,
        where('userId', '==', currentUid),
        orderBy('transactionDate', 'desc'),
        startAfter(txCursor),
        limit(20)
      );

      const snap = await getDocs(q);
      const docs = snap.docs.map(d => {
        const data = d.data() as any;
        return {
          id: d.id,
          userId: data.userId,
          type: data.type,
          amount: typeof data.amount === 'number' ? data.amount : Number(data.amount || 0),
          description: data.description || '',
          transactionDate: data.transactionDate?.toDate ? data.transactionDate.toDate() : new Date(data.transactionDate),
          relatedId: data.relatedId,
        } as Tx;
      });

      const lastVisible = snap.docs[snap.docs.length - 1] || null;

      setTxs(prev => reset ? docs : [...prev, ...docs]);
      setTxCursor(lastVisible);
      setTxHasMore(Boolean(lastVisible));

      // summary
      const earned = docs.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), reset ? 0 : earnedTotal);
      const spent = docs.reduce((sum, t) => sum + (t.amount < 0 ? Math.abs(t.amount) : 0), reset ? 0 : spentTotal);
      const net = (reset ? 0 : netTotal) + docs.reduce((sum, t) => sum + t.amount, 0);

      setEarnedTotal(earned);
      setSpentTotal(spent);
      setNetTotal(net);

      setTxTotalCount(prev => (reset ? docs.length : (prev ?? 0) + docs.length));
    } catch (e: any) {
      console.error('포인트 내역 로딩 실패:', e);
      const message = String(e?.message || e);
      const code = e?.code;
      setTxError('포인트 내역을 불러오지 못했습니다.');
      // 인덱스 미구성 등으로 orderBy 쿼리가 실패한 경우, 정렬/페이지네이션 없는 폴백
      if (code === 'failed-precondition' || message.includes('index')) {
        try {
          const colRef = collection(db, 'pointTransactions');
          const q2 = query(colRef, where('userId', '==', currentUid), limit(20));
          const snap2 = await getDocs(q2);
          const docs2 = snap2.docs.map(d => {
            const data = d.data() as any;
            return {
              id: d.id,
              userId: data.userId,
              type: data.type,
              amount: typeof data.amount === 'number' ? data.amount : Number(data.amount || 0),
              description: data.description || '',
              transactionDate: data.transactionDate?.toDate ? data.transactionDate.toDate() : new Date(data.transactionDate),
              relatedId: data.relatedId,
            } as Tx;
          });

          setTxs(prev => reset ? docs2 : [...prev, ...docs2]);
          setTxCursor(null);
          setTxHasMore(false);

          const earned = docs2.reduce((sum, t) => sum + (t.amount > 0 ? t.amount : 0), reset ? 0 : earnedTotal);
          const spent = docs2.reduce((sum, t) => sum + (t.amount < 0 ? Math.abs(t.amount) : 0), reset ? 0 : spentTotal);
          const net = (reset ? 0 : netTotal) + docs2.reduce((sum, t) => sum + t.amount, 0);

          setEarnedTotal(earned);
          setSpentTotal(spent);
          setNetTotal(net);

          setTxTotalCount(prev => (reset ? docs2.length : (prev ?? 0) + docs2.length));
          setTxError('인덱스가 없어 기본 정렬로 표시합니다. 콘솔에서 인덱스를 생성하면 정렬/페이지네이션이 활성화됩니다.');
        } catch (e2) {
          console.error('Fallback 쿼리 실패:', e2);
        }
      }
    } finally {
      setTxLoading(false);
    }
  }, [uid, txCursor, txLoading, earnedTotal, spentTotal, netTotal, txTotalCount]);

  useEffect(() => {
    if (!uid) return;
    // 초기 로드 및 유저 변경 시 리셋
    setTxs([]);
    setTxCursor(null);
    setTxHasMore(true);
    setEarnedTotal(0);
    setSpentTotal(0);
    setNetTotal(0);
    setTxTotalCount(null);
    fetchTransactions(true);
  }, [uid]);

  // user 객체가 없으면 로더 표시
  if (!user) {
    return <Text ta="center" py="xl">로그인이 필요합니다...</Text>;
  }
  return (
    <AppShell>
      <Container size="xxl" py="xl">
        <Title order={2} mb="lg">내 프로필</Title>
          <Grid>
            <Grid.Col span={{ base: 12, md: 9 }}>
              <Paper withBorder shadow="md" p="xl" radius="md" mb="xl">
          <Tabs defaultValue="profile">
            <Tabs.List mb="md">
              <Tabs.Tab value="profile" leftSection={<IconUser size={16} />}>
                프로필 정보
              </Tabs.Tab>
              {!(user.isAnonymous || user.providerData.some(provider => provider.providerId === 'google.com')) && (
                <Tabs.Tab value="password" leftSection={<IconLock size={16} />}>
                  비밀번호 변경
                </Tabs.Tab>
              )}
              {user.isAnonymous && (
                <Tabs.Tab value="convert" leftSection={<IconUserPlus size={16} />}>
                  정식 계정으로 전환
                </Tabs.Tab>
              )}
              <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>
                계정 설정
              </Tabs.Tab>
              <Tabs.Tab value="stats" leftSection={<IconChartBar size={16} />}>
                통계
              </Tabs.Tab>
            </Tabs.List>
            
            <Tabs.Panel value="profile">
              {/* 익명 로그인 사용자는 프로필 업데이트를 제한합니다. */}
              {user.isAnonymous ? (
                <Text>익명 로그인 사용자는 프로필을 업데이트할 수 없습니다.</Text>
              ) : (
                <form onSubmit={profileForm.onSubmit(updateUserProfile)}>
                  <Stack>
                    <TextInput
                      label="이름"
                    placeholder="이름을 입력하세요"
                    required
                    {...profileForm.getInputProps('displayName')}
                  />
                  
                  <TextInput
                    label="이메일"
                    placeholder="이메일을 입력하세요"
                    readOnly
                    {...profileForm.getInputProps('email')}
                  />
                  
                  <Group>
                    <input
                      type="file"
                      id="profileImageUpload"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={handleImageChange}
                    />
                    <Button
                      component="label"
                      htmlFor="profileImageUpload"
                      variant="light"
                      leftSection={<IconPhoto size={16} />}
                    >
                      프로필 이미지 변경
                    </Button>
                  </Group>
                  
                  <Button type="submit" loading={loading}>
                    프로필 업데이트
                      </Button>
                    </Stack>
                  </form>
                )}
              
            </Tabs.Panel>
            
            <Tabs.Panel value="password">
              <form onSubmit={passwordForm.onSubmit(updateUserPassword)}>
                <Stack>
                  <PasswordInput
                    label="현재 비밀번호"
                    placeholder="현재 비밀번호를 입력하세요"
                    required
                    {...passwordForm.getInputProps('currentPassword')}
                  />
                  
                  <PasswordInput
                    label="새 비밀번호"
                    placeholder="새 비밀번호를 입력하세요"
                    required
                    {...passwordForm.getInputProps('newPassword')}
                  />
                  
                  <PasswordInput
                    label="새 비밀번호 확인"
                    placeholder="새 비밀번호를 다시 입력하세요"
                    required
                    {...passwordForm.getInputProps('confirmPassword')}
                  />
                  
                  <Button type="submit" loading={loading}>
                    비밀번호 변경
                  </Button>
                </Stack>
              </form>
            </Tabs.Panel>
            
            <Tabs.Panel value="convert">
              <form onSubmit={convertAccountForm.onSubmit(convertAnonymousAccount)}>
                <Stack>
                  <Text mb="md">
                    익명 계정을 정식 계정으로 전환하면 현재 계정의 모든 데이터가 유지되며, 이메일과 비밀번호로 로그인할 수 있습니다.
                  </Text>
                  
                  <TextInput
                    label="이메일"
                    placeholder="사용할 이메일을 입력하세요"
                    required
                    {...convertAccountForm.getInputProps('email')}
                  />
                  
                  <PasswordInput
                    label="비밀번호"
                    placeholder="사용할 비밀번호를 입력하세요"
                    required
                    {...convertAccountForm.getInputProps('password')}
                  />
                  
                  <PasswordInput
                    label="비밀번호 확인"
                    placeholder="비밀번호를 다시 입력하세요"
                    required
                    {...convertAccountForm.getInputProps('confirmPassword')}
                  />
                  
                  <Button type="submit" color="blue" loading={loading}>
                    계정 전환하기
                  </Button>
                </Stack>
              </form>
            </Tabs.Panel>
            
            <Tabs.Panel value="stats">
              <Stack>
                <Group grow>
                  <Paper withBorder p="md" radius="md">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <IconCoin size={16} />
                        <Text fw={600}>총 획득</Text>
                      </Group>
                      <Text fw={700} c="green">{earnedTotal.toLocaleString()} P</Text>
                    </Group>
                  </Paper>
                  <Paper withBorder p="md" radius="md">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <IconCoin size={16} />
                        <Text fw={600}>총 사용</Text>
                      </Group>
                      <Text fw={700} c="red">-{spentTotal.toLocaleString()} P</Text>
                    </Group>
                  </Paper>
                  <Paper withBorder p="md" radius="md">
                    <Group justify="space-between" align="center">
                      <Group gap="xs">
                        <IconCoin size={16} />
                        <Text fw={600}>순증가</Text>
                      </Group>
                      <Text fw={700}>{netTotal.toLocaleString()} P</Text>
                    </Group>
                  </Paper>
                </Group>

                <Divider my="sm" />
                <Group justify="space-between" align="center">
                  <Text fw={600}>포인트 사용 내역</Text>
                  <Text size="sm" c="dimmed">
                    {txTotalCount !== null ? `총 ${txTotalCount.toLocaleString()}건` : ''}
                  </Text>
                </Group>
                {txError && <Text c="red" size="sm" mt="xs">{txError}</Text>}

                <Paper withBorder radius="md">
                  <Table striped highlightOnHover withTableBorder withColumnBorders>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>일시</Table.Th>
                        <Table.Th>유형</Table.Th>
                        <Table.Th>설명</Table.Th>
                        <Table.Th ta="right">금액</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {txs.map((t) => (
                        <Table.Tr key={t.id}>
                          <Table.Td width={180}>{new Date(t.transactionDate).toLocaleString()}</Table.Td>
                          <Table.Td width={120}>
                            <Badge variant="light" color={t.amount >= 0 ? 'green' : 'red'}>
                              {t.type}
                            </Badge>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              <Text>{t.description || '-'}</Text>
                              {t.relatedId && (
                                <Text size="xs" c="dimmed">관련 ID: {t.relatedId}</Text>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td ta="right" style={{ whiteSpace: 'nowrap' }}>
                            <Text c={t.amount >= 0 ? 'green' : 'red'}>
                              {t.amount >= 0 ? `+${t.amount.toLocaleString()} P` : `${t.amount.toLocaleString()} P`}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                      {txs.length === 0 && !txLoading && (
                        <Table.Tr>
                          <Table.Td colSpan={4} style={{ textAlign: 'center' }}>
                            내역이 없습니다.
                          </Table.Td>
                        </Table.Tr>
                      )}
                    </Table.Tbody>
                  </Table>
                </Paper>

                <Group justify="center" mt="sm">
                  <Button variant="light" onClick={() => fetchTransactions(false)} loading={txLoading} disabled={!txHasMore}>
                    {txHasMore ? '더 보기' : '더 이상 내역 없음'}
                  </Button>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="settings">
              <Stack>
                <Text fw={500} mb="xs">채팅 설정</Text>
                
                <Stack gap="md"> {/* Increased gap */}
                  <NumberInput
                    label="채팅 기억력 (메시지 수)"
                    description="캐릭터가 기억할 최대 메시지 수입니다. 0을 입력하면 모든 메시지를 기억합니다."
                    min={membershipTier !== 'premium' ? 1 : 0}
                    step={1}
                    value={settings.memoryCapacity}
                    onChange={(value) => updateSettings({ memoryCapacity: Number(value) || 0 })}
                    allowDecimal={false}
                  />
                </Stack>
                  <Switch
                    label="채팅 입력창에 페르소나 선택 표시"
                    checked={settings.showPersonaSelector}
                    onChange={(event) => updateSettings({ showPersonaSelector: event.currentTarget.checked })}
                  />
                
                <Divider my="md" />                

                {/* Persona Selection Section */}
                <Text fw={500} mb="xs">페르소나 설정</Text>
                {publicCharactersError && (
                  <Text c="red" size="sm" mb="xs">공개 캐릭터 로딩 중 오류 발생: {publicCharactersError}</Text>
                )}
                <Select
                  label="채팅 페르소나 선택"
                  placeholder="검색하여 페르소나 선택..."
                  data={personaSelectData} // Use the memoized data defined above
                  value={selectedPersonaId}
                  onChange={handlePersonaChange}
                  disabled={personaLoading || loadingPublicCharacters} // Disable if either user data or public chars are loading
                  searchable
                  searchValue={personaSearchTerm}
                  onSearchChange={setPersonaSearchTerm}
                  clearable // Allow clearing the selection
                  leftSection={personaLoading || loadingPublicCharacters ? <Loader size="xs" /> : <IconRobot size={16} />} // Show loader
                  mb="md"
                  nothingFoundMessage={personaSearchTerm ? "검색 결과가 없습니다." : "선택 가능한 페르소나가 없습니다."} // Differentiate message based on search
                />
                <Text size="xs" c="dimmed" mb="md">
                  {/* @react-no-unescaped-entities */}
                  여기서 선택한 캐릭터의 설정이 채팅 시 플레이어의 페르소나로 사용됩니다. &apos;없음&apos;을 선택하면 기본 페르소나로 대화합니다.
                </Text>
                {/* End Persona Selection Section */}

                <Divider my="md" />
                
                <Text fw={500} mb="xs">계정 관리</Text>
                <Button
                  variant="outline"
                  color="blue"
                  onClick={() => router.push('/profile/characters')}
                  mb="xs"
                >
                  내 캐릭터 관리
                </Button>

                {/* {patreonLoading ? (
                  <Loader size="sm" />
                ) : patreonData && patreonData.patronStatus === 'active_patron' ? (
                  <Group>
                    <Button
                      variant="filled"
                      color="green"
                      leftSection={<IconBrandPatreon size={18} />}
                      disabled
                    >
                      Patreon 연동됨 (티어: {patreonData.tierId ? `ID ${patreonData.tierId.substring(0,6)}...` : '정보 없음'})
                    </Button>
                    <Button
                      variant="outline"
                      color="red"
                      onClick={handlePatreonUnlink}
                      leftSection={<IconUnlink size={16} />}
                      loading={patreonLoading}
                    >
                      Patreon 연동 해제
                    </Button>
                  </Group>
                ) : patreonData ? (
                     <Stack gap="sm">
                        <Text size="sm" c="dimmed">현재 Patreon 계정 ({patreonData.patreonUserId?.substring(0,8)}...)이(가) 연동되어 있으나, 활성 후원 상태가 아닙니다 (상태: {patreonData.patronStatus || '알 수 없음'}).</Text>
                        <TextInput
                          label="Patreon 연동/재연동용 이메일"
                          placeholder="Firebase 계정 이메일과 동일한 이메일 권장"
                          value={patreonLinkEmail}
                          onChange={(event) => setPatreonLinkEmail(event.currentTarget.value)}
                          mb="xs"
                        />
                        <Group>
                            <Button
                                variant="outline"
                                color="orange"
                                leftSection={<IconBrandPatreon size={18} />}
                                onClick={handlePatreonLink}
                                loading={patreonLoading}
                            >
                                Patreon 재연동 시도
                            </Button>
                            <Button
                                variant="outline"
                                color="red"
                                onClick={handlePatreonUnlink}
                                leftSection={<IconUnlink size={16} />}
                                loading={patreonLoading}
                            >
                                Patreon 연동 정보 삭제
                            </Button>
                        </Group>
                    </Stack>
                ) : (
                  <Stack gap="sm">
                    <TextInput
                      label="Patreon 연동용 이메일"
                      placeholder="Firebase 계정 이메일과 동일한 이메일 권장"
                      description="Patreon에 등록된 이메일과 Firebase 계정 이메일이 일치해야 연동이 원활합니다."
                      value={patreonLinkEmail}
                      onChange={(event) => setPatreonLinkEmail(event.currentTarget.value)}
                      mb="xs"
                    />
                    <Button
                      variant="filled"
                      color="indigo" // Patreon 브랜드 색상과 유사하게
                      onClick={handlePatreonLink}
                      leftSection={<IconBrandPatreon size={18} />}
                      loading={patreonLoading}
                    >
                      Patreon 연동하기
                    </Button>
                  </Stack>
                )}
                 */}
                <Divider my="md" />
                
                <Text fw={500} mb="xs" c="red">위험 영역</Text>
                
                <Button
                  variant="outline"
                  color="red"
                  onClick={handleLogout}
                >
                  로그아웃
                </Button>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Paper>
            </Grid.Col>
                 <Grid.Col span={{ base: 12, md: 3 }}>
              <Stack>
                <Paper withBorder shadow="md" p="xl" radius="md">
                  <Group mb="xl">
                    <Avatar
                      src={imagePreview || getProxiedStorageUrl(user.photoURL)}
                      size={100}
                      radius={100}
                      color="purple"
                    >
                      {user.displayName?.charAt(0) || 'U'}
                    </Avatar>
                    <div>
                      <Title order={3}>{user.displayName}</Title>
                      <Text c="dimmed">{user.email}</Text>
                    </div>
                  </Group>
                   <Button
                    variant="outline"
                    color="red"
                    onClick={handleLogout}
                    fullWidth
                  >
                    로그아웃
                  </Button>
                </Paper>
                <AttendanceCard />
              </Stack>
            </Grid.Col>
          </Grid>
      </Container>
    </AppShell>
  );
}
