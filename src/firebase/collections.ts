 // src/firebase/collections.ts

// User related collections
export const USERS_COLLECTION = 'users';
export const PATREON_USER_DATA_COLLECTION = (userId: string) => `${USERS_COLLECTION}/${userId}/patreonData`; // Subcollection for Patreon specific data

// Point system related collections
export const POINT_BALANCES_COLLECTION = 'pointBalances'; // Stores current point balance for each user
export const POINT_TRANSACTIONS_COLLECTION = 'pointTransactions'; // Stores all point transactions

// Goods system related collections
export const GOODS_ITEMS_COLLECTION = 'goodsItems'; // Master list of all available goods
export const USER_GOODS_INVENTORY_COLLECTION = (userId: string) => `${USERS_COLLECTION}/${userId}/goodsInventory`; // User's owned goods
export const GIFT_HISTORY_COLLECTION = 'giftHistory'; // History of gifts exchanged

// Patreon specific data (might be stored within user documents or as a separate collection if complex)
// For now, assuming patreonData will be a subcollection under each user.

// Firestore document IDs (examples, can be customized)
export const getPatreonUserDataDocId = (patreonUserId: string) => patreonUserId; // Or use Arona user ID if mapping is 1:1
export const getPointBalanceDocId = (userId: string) => userId;

/**
 * Rankings collections (KST-based snapshots)
 */
export const RANKINGS_DAILY_COLLECTION = 'rankings_daily';
export const RANKINGS_WEEKLY_COLLECTION = 'rankings_weekly';
export const RANKINGS_MONTHLY_COLLECTION = 'rankings_monthly';

// Character rankings collections
export const RANKINGS_CHARACTER_DAILY_COLLECTION = 'rankings_character_daily';
export const RANKINGS_CHARACTER_WEEKLY_COLLECTION = 'rankings_character_weekly';
export const RANKINGS_CHARACTER_MONTHLY_COLLECTION = 'rankings_character_monthly';
