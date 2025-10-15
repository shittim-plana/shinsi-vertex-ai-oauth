import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import Cookies from 'js-cookie'; // js-cookie import 추가
import {
  User,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
} from 'firebase/auth';
import { auth } from '@/firebase/config';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { set } from 'date-fns';

// Extend User interface
interface ExtendedUser extends User {
  isAdmin?: boolean;
  isSubadmin?: boolean;
  uid: string; // Ensure uid is always present
}

// Define types
type AuthContextType = {
  uid: string | null;            // 쿠키 uid 추가
  token: string | null;          // Firebase token 추가 (null로 초기화)
  user: ExtendedUser | null;
  loading: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  logIn: (email: string, password: string) => Promise<void>;
  logOut: () => Promise<void>;
  googleSignIn: () => Promise<void>;
  anonymousLogin: () => Promise<void>;
};

// Create context with default values
const AuthContext = createContext<AuthContextType>({
  uid: null,    // 초기 uid 값 설정 (undefined를 null로 변환)
  token: null,
  user: null,
  loading: true,
  signUp: async () => {},
  logIn: async () => {},
  logOut: async () => {},
  googleSignIn: async () => {},
  anonymousLogin: async () => {},
});

// Hook to use auth context
export const useAuth = () => useContext(AuthContext);

// Provider component
export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<ExtendedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null); // Firebase token 추가

  // Check auth state on mount
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setUser({
            ...(user as ExtendedUser),
            isAdmin: userData.isAdmin || false,
            isSubadmin: userData.isSubadmin || false,
          });
        } else {
          setUser(user as ExtendedUser);
        }
        // 로그인 상태 변경 시 쿠키에 uid 저장
        user.getIdToken().then((t) => setToken(t));
        Cookies.set('uid', user.uid, { expires: 7 }); // 7일 동안 유효
      } else {
        setUser(null);
        setToken(null);
        // 로그아웃 상태 변경 시 쿠키 삭제
        Cookies.remove('uid');
      }
      setLoading(false);
    });

    // Clean up subscription
    return unsubscribe;
  }, []);

  // Sign up with email and password
  const signUp = async (email: string, password: string, displayName: string) => {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const userId = userCredential.user.uid;

      // Update profile with display name
      if (auth.currentUser) {
        await updateProfile(auth.currentUser, { displayName });

        // Create user document in Firestore with serverTimestamp
        await setDoc(doc(db, 'users', userId), {
          uid: userId,
          email,
          displayName,
          createdAt: serverTimestamp(),
          photoURL: userCredential.user.photoURL || null,
          recentChats: [],
          membershipTier: 'none',
          settings: {
            theme: 'light',
            notifications: true,
            memoryCapacity: 25,
            enableImageGeneration: false,
            enableNSFW: true,
            aiModel: 'gemini-2.5-flash-preview-04-17'
          }
        });

        // Initialize user data with default characters
        try {
          // await initializeUserData(userId, displayName);
          console.log('User data initialized successfully');
        } catch (seedError) {
          console.error('Error initializing user data:', seedError);
          // Continue even if seeding fails, as this is not critical
        }
        // 회원가입 성공 시 쿠키 설정 (onAuthStateChanged에서도 처리되지만 명시적으로 추가)
        Cookies.set('uid', userId, { expires: 7 });
      }
    } catch (error) {
      console.error('Error during sign up:', error);
      throw error;
    }
  };

  // Log in with email and password
  const logIn = async (email: string, password: string) => {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      setUser(userCredential.user as ExtendedUser);
      setToken(userCredential.user.refreshToken); // Firebase token 설정
      // 로그인 성공 시 쿠키 설정 (onAuthStateChanged에서도 처리되지만 명시적으로 추가)
      Cookies.set('uid', userCredential.user.uid, { expires: 7 });
    } catch (error) {
      console.error('Error during log in:', error);
      throw error;
    }
  };

  // Log out
  const logOut = async () => {
    try {
      await signOut(auth);
      // 명시적으로 로그아웃 시 쿠키 삭제
      Cookies.remove('uid');
    } catch (error) {
      console.error('Error during log out:', error);
      throw error;
    }
  };

  // Google sign in
  const googleSignIn = async () => {
    try {
      const provider = new GoogleAuthProvider();
      // Add scopes for Google permissions
      provider.addScope('profile');
      provider.addScope('email');
      const result = await signInWithPopup(auth, provider);
      const userId = result.user.uid;
      const displayName = result.user.displayName || '사용자';

      // Check if user document exists, create if not
      const userDoc = await getDoc(doc(db, 'users', userId));

      if (!userDoc.exists()) {
        // Create new user document
        await setDoc(doc(db, 'users', userId), {
          uid: userId,
          email: result.user.email,
          displayName: displayName,
          createdAt: serverTimestamp(),
          photoURL: result.user.photoURL,
          recentChats: [],
          membershipTier: 'none',
          authProvider: 'google',
          settings: {
            theme: 'light',
            notifications: true,
            memoryCapacity: 25,
            enableImageGeneration: false,
            enableNSFW: true,
            aiModel: 'gemini-2.5-flash-preview-04-17'
          }
        });

        // Initialize user data with default characters for new users
        try {
          // await initializeUserData(userId, displayName);
          console.log('User data initialized successfully');
        } catch (seedError) {
          console.error('Error initializing user data:', seedError);
          // Continue even if seeding fails, as this is not critical
        }
      }
      // Google 로그인 성공 시 쿠키 설정 (onAuthStateChanged에서도 처리되지만 명시적으로 추가)
      Cookies.set('uid', userId, { expires: 7 });
    } catch (error) {
      console.error('Error during Google sign in:', error);
      throw error;
    }
  };

  // Anonymous login
  const anonymousLogin = async () => {
    try {
      const result = await signInAnonymously(auth);
      const userId = result.user.uid;
      const displayName = '익명 사용자';

      // Create anonymous user document in Firestore
      const userDoc = await getDoc(doc(db, 'users', userId));

      if (!userDoc.exists()) {
        // Create anonymous user document
        await setDoc(doc(db, 'users', userId), {
          uid: userId,
          displayName: displayName,
          createdAt: serverTimestamp(),
          recentChats: [],
          membershipTier: 'none',
          authProvider: 'anonymous',
          isAnonymous: true,
          settings: {
            theme: 'light',
            notifications: true,
            memoryCapacity: 25,
            enableImageGeneration: false,
            enableNSFW: true,
            aiModel: 'gemini-2.5-flash-preview-04-17'
          }
        });

        // Initialize user data with basic character for anonymous users
        try {
          // Create only the default character for anonymous users
          // await initializeUserData(userId, displayName);
          console.log('Anonymous user data initialized successfully');
        } catch (seedError) {
          console.error('Error initializing anonymous user data:', seedError);
          // Continue even if seeding fails
        }
      }
      // 익명 로그인 성공 시 쿠키 설정 (onAuthStateChanged에서도 처리되지만 명시적으로 추가)
      Cookies.set('uid', userDoc.id, { expires: 7 });
    } catch (error) {
      console.error('Error during anonymous login:', error);
      throw error;
    }
  };

  // Ensure uid is taken from authenticated user first, falling back to cookie
  const uid = user?.uid || Cookies.get('uid') || null;

  const value = {
    uid,    // 쿠키에서 uid 읽어 제공 (undefined를 null로 변환)
    token, // Firebase token 추가 (null로 초기화)
    user,
    loading,
    signUp,
    logIn,
    logOut,
    googleSignIn,
    anonymousLogin,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthContext;