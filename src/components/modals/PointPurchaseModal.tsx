import React, { useState } from 'react';
import { Modal, Button, Group, Text, Radio, Loader } from '@mantine/core';
import { useAuth } from '@/contexts/AuthContext';
import { loadStripe } from '@stripe/stripe-js';
import { auth } from '@/firebase/config';

const stripePromise = loadStripe('pk_live_51RNATALpyVRnWjRZncLL5O4eegAS5hZErT3uIiS4ERPH5Anh5Hc55iDMkggCVulyZVVatF2BDn59U9ZCqCOWnVF200WrySQpop');

const pointOptions = [
  { value: 'price_1RsYFNLpyVRnWjRZCyKTTS9U', label: '$5 (500,000 포인트)', points: 500000 },
  { value: 'price_1RsYMDLpyVRnWjRZghaxE8fD', label: '$10 (1,000,000 포인트)', points: 1000000 },
  { value: 'price_1RsYMVLpyVRnWjRZXhHLNyJL', label: '$20 (2,000,000 포인트)', points: 2000000 },
];

interface PointPurchaseModalProps {
  opened: boolean;
  onClose: () => void;
}

const PointPurchaseModal: React.FC<PointPurchaseModalProps> = ({ opened, onClose }) => {
  const { user } = useAuth();
  const [selectedValue, setSelectedValue] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePurchase = async () => {
    const currentUser = auth.currentUser;
    if (!selectedValue || !currentUser) {
      setError('결제 항목을 선택하거나 로그인이 필요합니다.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await currentUser.getIdToken();
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ priceId: selectedValue, userUid: currentUser.uid }),
      });

      if (!response.ok) {
        const { error } = await response.json();
        throw new Error(error || '결제 세션 생성에 실패했습니다.');
      }

      const { sessionId } = await response.json();
      const stripe = await stripePromise;
      if (stripe) {
        await stripe.redirectToCheckout({ sessionId });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="포인트 구매" centered>
      <Radio.Group
        value={selectedValue}
        onChange={setSelectedValue}
        name="pointOption"
        label="구매할 포인트를 선택하세요"
        withAsterisk
      >
        {pointOptions.map(option => (
          <Radio key={option.value} value={option.value} label={option.label} my="sm" />
        ))}
      </Radio.Group>
      
      {error && <Text color="red" size="sm" mt="sm">{error}</Text>}

      <Group mt="xl">
        <Button onClick={handlePurchase} disabled={!selectedValue || loading}>
          {loading ? <Loader size="sm" /> : '결제하기'}
        </Button>
      </Group>
    </Modal>
  );
};

export default PointPurchaseModal;