import { Card, Text, Button, Group, Badge, Modal, Stack } from '@mantine/core';
import { useAuth } from '@/contexts/AuthContext';
import { useAttendance } from '@/hooks/useAttendance';
import { useState } from 'react';
import { ClaimResponse } from '@/types/attendance';

export function AttendanceCard() {
  const { user } = useAuth();
  const { status, loading, error, claimAttendance, refreshStatus } = useAttendance();
  const [modalOpened, setModalOpened] = useState(false);
  const [modalContent, setModalContent] = useState<ClaimResponse | null>(null);

  const handleClaim = async () => {
    if (!user) return;
    const result = await claimAttendance();
    if (result && result.success) {
      setModalContent(result);
      setModalOpened(true);
      refreshStatus();
    }
  };

  if (!user) {
    return (
      <Card withBorder shadow="sm" padding="lg" radius="md">
        <Text>로그인 후 출석 체크를 해주세요.</Text>
      </Card>
    );
  }

  return (
    <>
      <Card withBorder shadow="sm" padding="lg" radius="md">
        <Stack gap="md">
          <Group justify="space-between">
            <Text fw={700} size="lg">출석 체크</Text>
            {status.todayClaimed && <Badge color="green">오늘 출석 완료</Badge>}
          </Group>
          {error && <Text c="red">{error}</Text>}
          <Text>이번 달 출석 횟수: {status.claimCount || 0}회</Text>
          <Text>현재 보상 배수: {status.multiplier?.toFixed(1) || '1.0'}배</Text>
          <Button onClick={handleClaim} loading={loading} disabled={status.todayClaimed}>
            {status.todayClaimed ? '내일 다시 오세요!' : '출석하고 포인트 받기'}
          </Button>
        </Stack>
      </Card>

      <Modal opened={modalOpened} onClose={() => setModalOpened(false)} title="출석 보상">
        {modalContent && (
          <Stack>
            <Text>🎉 출석이 완료되었습니다!</Text>
            <Text>지급된 포인트: {modalContent.awardedAmount?.toLocaleString()} P</Text>
            <Text>적용된 배수: {modalContent.multiplier?.toFixed(1)}배</Text>
            <Text>다음 배수: {modalContent.nextMultiplier?.toFixed(1)}배</Text>
            <Text>현재 잔액: {modalContent.balance?.toLocaleString()} P</Text>
          </Stack>
        )}
      </Modal>
    </>
  );
}