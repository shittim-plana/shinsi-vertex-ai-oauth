'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { Container, Title, SimpleGrid, Card, Image, Text, Badge, Group, Button, Loader, Alert, Modal, Stack, Flex } from '@mantine/core'; // Modal, Stack, Flex 추가
import { IconAlertCircle, IconShoppingCartPlus, IconInfoCircle, IconCoin } from '@tabler/icons-react'; // IconInfoCircle, IconCoin 추가
import { AppShell } from '@/components/layout/AppShell';
import PointPurchaseModal from '@/components/modals/PointPurchaseModal'; // 포인트 구매 모달 추가
import { db, goodsItemsCol, pointBalanceDoc, pointTransactionDoc, pointTransactionsCol, userGoodsInventoryCol, goodsItemDoc } from '@/firebase/config'; // db, Firestore 헬퍼 추가
import { GoodsItem, UserGoodsInventory } from '@/types/goods';
import { PointBalance, PointTransaction } from '@/types/point'; // Point 관련 타입 추가
import { getDocs, query, orderBy, writeBatch, Timestamp, doc, getDoc, runTransaction } from 'firebase/firestore'; // writeBatch, Timestamp, doc, getDoc, runTransaction 추가
import { useAuth } from '@/contexts/AuthContext';
import { notifications } from '@mantine/notifications';
import { useRouter, useSearchParams } from 'next/navigation'; // useRouter, useSearchParams 추가

function PaymentStatusHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      notifications.show({
        title: '결제 성공',
        message: '포인트가 성공적으로 충전되었습니다. 잠시 후 잔액에 반영됩니다.',
        color: 'green',
      });
    } else if (paymentStatus === 'cancel') {
      notifications.show({
        title: '결제 취소',
        message: '포인트 충전이 취소되었습니다.',
        color: 'yellow',
      });
    }
    // Clean up the URL
    if (paymentStatus) {
      router.replace('/goods', { scroll: false });
    }
  }, [searchParams, router]);

  return null; // This component does not render anything
}

export default function GoodsPage() {
  const { user, uid } = useAuth();
  const router = useRouter();
  const [goods, setGoods] = useState<GoodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [purchasingGoodsId, setPurchasingGoodsId] = useState<string | null>(null); // 구매 진행 중인 굿즈 ID
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [selectedGoodsToPurchase, setSelectedGoodsToPurchase] = useState<GoodsItem | null>(null);
  const [pointModalOpen, setPointModalOpen] = useState(false); // 포인트 구매 모달 상태


  const fetchGoods = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = query(goodsItemsCol, orderBy('createdAt', 'desc')); // 최신순 정렬
      const querySnapshot = await getDocs(q);
      const goodsList: GoodsItem[] = [];
      querySnapshot.forEach((doc) => {
        // Firestore 타임스탬프를 Date 객체로 변환
        const data = doc.data();
        goodsList.push({
          ...data,
          id: doc.id,
          createdAt: (data.createdAt as any)?.toDate ? (data.createdAt as any).toDate() : new Date(),
          updatedAt: (data.updatedAt as any)?.toDate ? (data.updatedAt as any).toDate() : new Date(),
        } as GoodsItem);
      });
      setGoods(goodsList);
    } catch (err) {
      console.error("굿즈 목록 로딩 에러:", err);
      setError('굿즈 목록을 불러오는 중 오류가 발생했습니다.');
      notifications.show({
        title: '로딩 실패',
        message: '굿즈 목록을 불러오지 못했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGoods();
  }, [fetchGoods]);

  const openPurchaseConfirmModal = (goodsItem: GoodsItem) => {
    if (!user) {
      notifications.show({
        title: '로그인 필요',
        message: '굿즈를 구매하려면 로그인이 필요합니다.',
        color: 'yellow',
      });
      router.push('/login');
      return;
    }
    setSelectedGoodsToPurchase(goodsItem);
    setConfirmModalOpen(true);
  };

  const handlePurchase = async () => {
    if (!user || !uid || !selectedGoodsToPurchase) {
      notifications.show({ title: '오류', message: '구매 처리 중 사용자 또는 상품 정보를 찾을 수 없습니다.', color: 'red' });
      setConfirmModalOpen(false);
      return;
    }

    setPurchasingGoodsId(selectedGoodsToPurchase.id);
    setConfirmModalOpen(false);

    const goodsToPurchase = selectedGoodsToPurchase; // 로컬 변수로 복사

    try {
      await runTransaction(db, async (transaction) => {
        const userPointBalanceRef = pointBalanceDoc(uid);
        const goodsItemRef = goodsItemDoc(goodsToPurchase.id);

        const pointBalanceSnap = await transaction.get(userPointBalanceRef);
        const goodsItemSnap = await transaction.get(goodsItemRef);

        if (!goodsItemSnap.exists()) {
          throw new Error("상품 정보를 찾을 수 없습니다. 다시 시도해주세요.");
        }

        const currentGoodsData = goodsItemSnap.data() as GoodsItem;
        if (currentGoodsData.stock !== null && currentGoodsData.stock !== undefined && currentGoodsData.stock <= 0) {
          throw new Error(`${currentGoodsData.name} 상품은 품절되었습니다.`);
        }

        let currentBalance = 0;
        if (pointBalanceSnap.exists()) {
          currentBalance = (pointBalanceSnap.data() as PointBalance).balance;
        }

        if (currentBalance < goodsToPurchase.price) {
          throw new Error(`포인트가 부족합니다. (필요: ${goodsToPurchase.price}P, 현재: ${currentBalance}P)`);
        }

        // 1. 포인트 차감
        const newBalance = currentBalance - goodsToPurchase.price;
        transaction.set(userPointBalanceRef, { userId: uid, balance: newBalance, lastUpdated: Timestamp.now() }, { merge: true });

        // 2. 포인트 거래 내역 기록
        const newTransactionId = doc(pointTransactionsCol).id; // 컬렉션 참조에서 새 ID 생성
        const transactionRef = pointTransactionDoc(newTransactionId);
        const newPointTransaction: PointTransaction = {
          id: newTransactionId,
          userId: uid,
          type: 'goods_purchase',
          amount: -goodsToPurchase.price,
          description: `${goodsToPurchase.name} 구매`,
          transactionDate: Timestamp.now().toDate(),
          relatedId: goodsToPurchase.id,
        };
        transaction.set(transactionRef, newPointTransaction);

        // 3. 사용자 인벤토리 추가
        const inventoryColRef = userGoodsInventoryCol(uid);
        const newInventoryItemId = doc(inventoryColRef).id; // 서브컬렉션 내에서 새 ID 생성
        const inventoryItemRef = doc(inventoryColRef, newInventoryItemId);

        const newUserGoodsInventory: UserGoodsInventory = {
          userId: uid,
          goodsId: goodsToPurchase.id,
          quantity: 1, // 기본 수량 1
          acquisitionDate: Timestamp.now().toDate(),
          purchaseTransactionId: newTransactionId,
        };
        transaction.set(inventoryItemRef, newUserGoodsInventory);

        // 4. 굿즈 재고 차감 (재고가 있는 경우)
        if (currentGoodsData.stock !== null && currentGoodsData.stock !== undefined) {
          transaction.update(goodsItemRef, { stock: currentGoodsData.stock - 1 });
        }
      });

      notifications.show({
        title: '구매 완료',
        message: `${goodsToPurchase.name}을(를) 성공적으로 구매했습니다!`,
        color: 'green',
      });
      // 성공 후 굿즈 목록 새로고침 (재고 반영 등)
      fetchGoods();

    } catch (err: any) {
      console.error("굿즈 구매 에러:", err);
      notifications.show({
        title: '구매 실패',
        message: err.message || '굿즈 구매 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setPurchasingGoodsId(null);
      setSelectedGoodsToPurchase(null);
    }
  };

  // ... (loading, error 렌더링 부분은 동일)

  if (loading) {
    return (
      <AppShell>
        <Container size="lg" py="xl" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
          <Loader />
        </Container>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell>
        <Container size="lg" py="xl">
          <Alert icon={<IconAlertCircle size="1rem" />} title="오류 발생" color="red">
            {error}
          </Alert>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Container size="lg" py="xl">
        <Suspense fallback={<Loader />}>
          <PaymentStatusHandler />
        </Suspense>
        <Flex justify="space-between" align="center" mb="xl">
          <Title order={2} ta="center">아로나 상점</Title>
          <Button
            leftSection={<IconCoin size={18} />}
            onClick={() => setPointModalOpen(true)}
            variant="gradient"
            gradient={{ from: 'indigo', to: 'cyan' }}
          >
            포인트 충전
          </Button>
        </Flex>
        
        {goods.length === 0 && !loading ? (
          <Text ta="center" c="dimmed">판매 중인 굿즈가 아직 없습니다.</Text>
        ) : (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing="lg">
            {goods.map((item) => (
              <Card shadow="sm" padding="lg" radius="md" withBorder key={item.id}>
                <Card.Section>
                  <Image
                    src={item.imageUrl || '/placeholder-goods.svg'}
                    height={180}
                    alt={item.name}
                    fallbackSrc="/placeholder-goods.svg"
                  />
                </Card.Section>

                <Group justify="space-between" mt="md" mb="xs">
                  <Text fw={500} truncate="end">{item.name}</Text>
                  {item.isPremium && <Badge color="pink" variant="light">프리미엄</Badge>}
                  {item.isExclusive && <Badge color="grape" variant="light">전용</Badge>}
                </Group>

                <Text size="sm" c="dimmed" lineClamp={3} mb="sm">
                  {item.description}
                </Text>

                <Badge color="blue" variant="outline" mb="md">
                  타입: {item.type.replace(/_/g, ' ').toUpperCase()}
                </Badge>
                
                {(item.stock !== null && item.stock !== undefined) && (
                    <Text size="xs" c={item.stock === 0 ? "red" : "dimmed"} mb="md">
                        재고: {item.stock > 0 ? `${item.stock}개 남음` : "품절"}
                    </Text>
                )}

                <Button
                  variant="light"
                  color="blue"
                  fullWidth
                  mt="md"
                  radius="md"
                  onClick={() => openPurchaseConfirmModal(item)}
                  disabled={item.stock === 0 || purchasingGoodsId === item.id}
                  loading={purchasingGoodsId === item.id}
                  leftSection={<IconShoppingCartPlus size={16} />}
                >
                  {item.price}P 구매하기
                </Button>
              </Card>
            ))}
          </SimpleGrid>
        )}
      </Container>

      <Modal
        opened={confirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        title={
          <Group>
            <IconInfoCircle />
            <Text fw={500}>구매 확인</Text>
          </Group>
        }
        centered
      >
        {selectedGoodsToPurchase && (
          <Stack>
            <Text>정말로 <Text span fw={700}>{selectedGoodsToPurchase.name}</Text>을(를)</Text>
            <Text><Text span fw={700}>{selectedGoodsToPurchase.price}P</Text>에 구매하시겠습니까?</Text>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={() => setConfirmModalOpen(false)}>취소</Button>
              <Button color="blue" onClick={handlePurchase} loading={!!purchasingGoodsId}>구매</Button>
            </Group>
          </Stack>
        )}
      </Modal>
      <PointPurchaseModal
        opened={pointModalOpen}
        onClose={() => setPointModalOpen(false)}
      />
    </AppShell>
  );
}
