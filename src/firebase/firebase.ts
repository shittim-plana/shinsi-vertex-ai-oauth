// Import the functions you need from the SDKs you need
import { initializeApp, getApps, getApp } from "firebase/app";
import { getAnalytics, isSupported, Analytics } from "firebase/analytics";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore, Firestore, memoryLocalCache } from "firebase/firestore";

// Your web app's Firebase configuration using environment variables
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID // Use the provided measurement ID
};

// Initialize Firebase only if it hasn't been initialized yet
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();


// Initialize Cloud Firestore conditionally based on environment
let db: Firestore;
// Determine Firestore settings based on environment
const firestoreSettings = typeof window !== 'undefined'
  ? {
      localCache: memoryLocalCache()
    }
  : {}; // Use default memory cache on server

try {
  // Attempt initialization with determined settings
  db = initializeFirestore(app, firestoreSettings);
} catch (e: any) { // Use 'any' or a more specific error type if known
  // Fallback for re-initialization issues (e.g., hot-reload)
  console.warn("Firestore initialization failed (might be due to hot-reload or existing instance), attempting to get existing instance:", e.message || e);
  db = getFirestore(app);
}

// Initialize Firebase Analytics only if supported
let analytics: Analytics | undefined;
if (typeof window !== 'undefined') {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  });
}

export { app, analytics, db };