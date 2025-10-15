// src/app/api/goods/gift/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/firebase/config';
import { doc, runTransaction, Timestamp, collection } from 'firebase/firestore';
import { GiftHistory, UserGoodsInventory } from '@/types/goods';
import { PointBalance, PointTransaction } from '@/types/point'; // 선물 시 포인트 차감이 있다면 필요
import {
  userGoodsInventoryCol,
  // giftHistoryCol, // Use direct collection name for new doc creation with auto-ID
  pointBalanceDoc, // 선물 자체에 비용이 드는 경우
  pointTransactionsCol, // 선물 자체에 비용이 드는 경우
  goodsItemDoc,
  GIFT_HISTORY_COLLECTION // Import the collection name constant
} from '@/firebase/config';

interface GiftRequestBody {
  senderUserId: string;
  recipientCharacterId: string;
  goodsId: string;
  inventoryItemId: string; // 사용자의 인벤토리에서 어떤 아이템을 선물하는지 식별
  quantityToGift?: number; // 기본값 1
  message?: string;
  // giftCost?: number; // 선물이 유료인 경우, 클라이언트에서 계산된 비용 (서버에서 재검증 필요)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as GiftRequestBody;
    const {
      senderUserId,
      recipientCharacterId,
      goodsId,
      inventoryItemId, // 이 ID로 userGoodsInventory에서 해당 아이템을 찾습니다.
      quantityToGift = 1,
      message,
      // giftCost // 선물 자체에 비용이 드는 경우
    } = body;

    if (!senderUserId || !recipientCharacterId || !goodsId || !inventoryItemId) {
      return NextResponse.json({ error: 'Missing required fields for gifting.' }, { status: 400 });
    }

    if (quantityToGift <= 0) {
      return NextResponse.json({ error: 'Quantity to gift must be positive.' }, { status: 400 });
    }

    await runTransaction(db, async (transaction) => {
      const userInventoryCollectionRef = userGoodsInventoryCol(senderUserId);
      const userInventoryItemRef = doc(userInventoryCollectionRef, inventoryItemId);
      const goodsMasterRef = goodsItemDoc(goodsId); // 원본 굿즈 정보 (이름 등 참조용)

      const inventoryItemSnap = await transaction.get(userInventoryItemRef);
      const goodsMasterSnap = await transaction.get(goodsMasterRef);

      if (!inventoryItemSnap.exists()) {
        throw new Error('선물하려는 아이템을 인벤토리에서 찾을 수 없습니다.');
      }
      if (!goodsMasterSnap.exists()) {
        throw new Error('선물하려는 굿즈 정보를 찾을 수 없습니다.');
      }

      const inventoryItemData = inventoryItemSnap.data() as UserGoodsInventory;
      const goodsMasterData = goodsMasterSnap.data(); // 이름 등 참조

      if (inventoryItemData.goodsId !== goodsId) {
        throw new Error('인벤토리 아이템과 요청된 굿즈 ID가 일치하지 않습니다.');
      }

      if (inventoryItemData.quantity < quantityToGift) {
        throw new Error(`보유 수량 부족: ${goodsMasterData.name} (보유: ${inventoryItemData.quantity}, 필요: ${quantityToGift})`);
      }

      // 1. (선택적) 선물 비용 차감 로직 (기획에 따라)
      // if (giftCost && giftCost > 0) {
      //   const userPointBalanceRef = pointBalanceDoc(senderUserId);
      //   const pointBalanceSnap = await transaction.get(userPointBalanceRef);
      //   let currentBalance = 0;
      //   if (pointBalanceSnap.exists()) {
      //     currentBalance = (pointBalanceSnap.data() as PointBalance).balance;
      //   }
      //   if (currentBalance < giftCost) {
      //     throw new Error(`선물 비용 부족: ${giftCost}P 필요`);
      //   }
      //   transaction.set(userPointBalanceRef, { balance: currentBalance - giftCost, lastUpdated: Timestamp.now() }, { merge: true });
      //
      //   const giftPointTxId = doc(pointTransactionsCol).id;
      //   const giftPointTxRef = doc(pointTransactionsCol, giftPointTxId);
      //   const giftTx: PointTransaction = {
      //     id: giftPointTxId,
      //     userId: senderUserId,
      //     type: 'goods_gift_fee', // 예시 타입
      //     amount: -giftCost,
      //     description: `${goodsMasterData.name} 선물 비용`,
      //     transactionDate: Timestamp.now().toDate(),
      //     relatedId: goodsId,
      //   };
      //   transaction.set(giftPointTxRef, giftTx);
      // }


      // 2. 사용자 인벤토리에서 굿즈 수량 차감 또는 삭제
      const newQuantity = inventoryItemData.quantity - quantityToGift;
      if (newQuantity > 0) {
        transaction.update(userInventoryItemRef, { quantity: newQuantity });
      } else {
        transaction.delete(userInventoryItemRef); // 수량이 0이 되면 삭제
      }

      // 3. 선물 히스토리 기록
      const giftHistoryRef = doc(collection(db, GIFT_HISTORY_COLLECTION)); // 새 ID 자동 생성
      const newGift: GiftHistory = {
        id: giftHistoryRef.id,
        senderUserId,
        recipientCharacterId,
        goodsId,
        quantity: quantityToGift,
        giftedAt: Timestamp.now().toDate(),
        message: message || '',
      };
      transaction.set(giftHistoryRef, newGift);
    });

    return NextResponse.json({ message: '선물이 성공적으로 전달되었습니다.' }, { status: 200 });

  } catch (error: any) {
    console.error('Error gifting goods:', error);
    return NextResponse.json({ error: '굿즈 선물 중 오류가 발생했습니다.', details: error.message }, { status: 500 });
  }
}
