import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { db } from './firebase'; // Import the configured db instance
import {
  collection,
  doc,
  DocumentData,
  CollectionReference,
  DocumentReference,
  FirestoreDataConverter,
} from 'firebase/firestore';

// Import your new types and collection constants
import { PatreonUserData, PatreonWebhookPayload } from '../types/patreon';
import { PointBalance, PointTransaction } from '../types/point';
import { GoodsItem, UserGoodsInventory, GiftHistory } from '../types/goods';
import {
  PATREON_USER_DATA_COLLECTION,
  POINT_BALANCES_COLLECTION,
  POINT_TRANSACTIONS_COLLECTION,
  GOODS_ITEMS_COLLECTION,
  USER_GOODS_INVENTORY_COLLECTION,
  GIFT_HISTORY_COLLECTION,
  USERS_COLLECTION,
} from './collections';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase - only initialize once
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const storage = getStorage(app);
const functions = getFunctions(app);

// FirestoreDataConverter for cleaner data handling
const createConverter = <T extends DocumentData>(): FirestoreDataConverter<T> => ({
  toFirestore: (data: T) => data,
  fromFirestore: (snapshot, options) => snapshot.data(options) as T,
});

// Typed collection and document references
// Patreon
export const patreonUserDataCol = (userId: string) =>
  collection(db, PATREON_USER_DATA_COLLECTION(userId)).withConverter(createConverter<PatreonUserData>());
export const patreonUserDataDoc = (userId: string, patreonId: string) =>
  doc(db, PATREON_USER_DATA_COLLECTION(userId), patreonId).withConverter(createConverter<PatreonUserData>());

// Points
export const pointBalancesCol = collection(db, POINT_BALANCES_COLLECTION).withConverter(createConverter<PointBalance>());
export const pointBalanceDoc = (userId: string) =>
  doc(db, POINT_BALANCES_COLLECTION, userId).withConverter(createConverter<PointBalance>());

export const pointTransactionsCol = collection(db, POINT_TRANSACTIONS_COLLECTION).withConverter(createConverter<PointTransaction>());
export const pointTransactionDoc = (transactionId: string) =>
  doc(db, POINT_TRANSACTIONS_COLLECTION, transactionId).withConverter(createConverter<PointTransaction>());

// Goods
export const goodsItemsCol = collection(db, GOODS_ITEMS_COLLECTION).withConverter(createConverter<GoodsItem>());
export const goodsItemDoc = (goodsId: string) =>
  doc(db, GOODS_ITEMS_COLLECTION, goodsId).withConverter(createConverter<GoodsItem>());

export const userGoodsInventoryCol = (userId: string) =>
  collection(db, USER_GOODS_INVENTORY_COLLECTION(userId)).withConverter(createConverter<UserGoodsInventory>());
export const userGoodsInventoryDoc = (userId: string, inventoryId: string) =>
  doc(db, USER_GOODS_INVENTORY_COLLECTION(userId), inventoryId).withConverter(createConverter<UserGoodsInventory>());

export const giftHistoryCol = collection(db, GIFT_HISTORY_COLLECTION).withConverter(createConverter<GiftHistory>());
export const giftHistoryDoc = (giftId: string) =>
  doc(db, GIFT_HISTORY_COLLECTION, giftId).withConverter(createConverter<GiftHistory>());

// User collection (if you need to reference the top-level user document itself)
// Assuming a simple User type for now, you might have a more complex one in src/types/user.ts or similar
interface UserProfile {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  // other profile fields
}
export const usersCol = collection(db, USERS_COLLECTION).withConverter(createConverter<UserProfile>());
export const userDoc = (userId: string) =>
  doc(db, USERS_COLLECTION, userId).withConverter(createConverter<UserProfile>());


export { 
  app, auth, db, storage, functions,
  // Export collection names for direct use if needed
  USERS_COLLECTION,
  PATREON_USER_DATA_COLLECTION,
  POINT_BALANCES_COLLECTION,
  POINT_TRANSACTIONS_COLLECTION,
  GOODS_ITEMS_COLLECTION,
  USER_GOODS_INVENTORY_COLLECTION,
  GIFT_HISTORY_COLLECTION
};
