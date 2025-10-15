'use client';

import { useState } from 'react';
import { Container, Title, Paper, TextInput, Button, Stack, Text, Group, Alert } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconTicket } from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext'; // 사용자 UID 및 logout 함수를 가져오기 위함
import { AppShell } from '@/components/layout/AppShell'; // AppShell을 사용하여 일관된 레이아웃 적용
import { useRouter } from 'next/navigation'; // 페이지 이동을 위해 추가

export default function RedeemCodePage() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const { uid, logOut } = useAuth(); // 현재 로그인된 사용자의 UID 및 logOut 함수 (AuthContext.tsx에 정의된 대로)
  const router = useRouter(); // 라우터 인스턴스

  const handleSubmit = async () => {
    if (!uid) {
      notifications.show({
        title: '로그인 필요',
        message: '코드를 사용하려면 먼저 로그인해주세요.',
        color: 'yellow',
        icon: <IconAlertCircle />,
      });
      return;
    }

    if (!code.trim()) {
      notifications.show({
        title: '코드 입력 필요',
        message: '사용할 코드를 입력해주세요.',
        color: 'yellow',
        icon: <IconAlertCircle />,
      });
      return;
    }

    setLoading(true);

    // API 엔드포인트 결정 (일반 쿠폰 vs Patreon 리딤 링크)
    // 여기서는 우선 일반 쿠폰 /api/coupons/redeem 을 사용한다고 가정합니다.
    // Patreon 리딤 링크의 경우, 코드 형식에 따라 분기하거나 별도 UI를 제공할 수 있습니다.
    // 예시: CC6D42D72A 와 같은 특정 형식의 코드는 Patreon 리딤 API로 보낼 수 있습니다.
    
    let endpoint = '/api/coupons/redeem';
    let payload: any = { code, userId: uid };
    let isPatreonLinkCode = false;
    let isMembershipCode = false;

    // Membership code pattern (simple example codes)
    const membershipCodePattern = /^(42b1cf3b-d862-4ce7-8a91-042e7122d713|a4b6f666-bc43-45a5-bcd2-433d7c517288|0797f14b-ad47-4f9f-aadb-0e421ab1df8f)$/i;
    if (membershipCodePattern.test(code)) {
      endpoint = '/api/membership/activate';
      isMembershipCode = true;
    }

    // Patreon 리딤 링크 코드 형식 (예시: 대문자와 숫자로만 구성된 10자리)
    const patreonLinkCodePattern = /^[A-Z0-9]{10}$/; 
    if (patreonLinkCodePattern.test(code)) {
       // 특정 코드 값으로도 확인 가능
      if (code === 'CC6D42D72A') { // 사용자가 제공한 특정 코드
        endpoint = `/api/patreon/redeem-link/${code}`;
        // Patreon 리딤 링크 API는 userId를 쿼리 파라미터로 받음
        payload = { userId: uid }; // GET 요청이므로 body 대신 query로 전달
        isPatreonLinkCode = true;
      }
    }

    try {
      const response = await fetch(isPatreonLinkCode ? `${endpoint}?userId=${uid}` : endpoint, {
        method: isPatreonLinkCode ? 'GET' : 'POST',
        headers: !isPatreonLinkCode ? { 'Content-Type': 'application/json' } : {},
        body: !isPatreonLinkCode ? JSON.stringify(payload) : undefined,
      });

      const data = await response.json();

      if (response.ok) {
        if (isMembershipCode && data.logoutRequired) {
          notifications.show({
            title: '멤버십 활성화 완료!',
            message: `${data.message || '멤버십이 활성화되었습니다.'} ${data.postLogoutMessage || '재로그인 후 적용됩니다.'}`,
            color: 'green',
            autoClose: 7000, // 사용자가 메시지를 읽을 충분한 시간
          });
          setCode('');
          if (logOut) {
            await logOut(); // 로그아웃 실행 (AuthContext.tsx에 정의된 대로)
            // AuthContext의 logOut 함수가 자동으로 리디렉션하지 않는 경우,
            // 또는 특정 페이지로 강제 이동시키고 싶을 때 아래 코드를 활성화할 수 있습니다.
            // router.push('/login');
          } else {
            // logOut 함수가 없을 경우에 대한 예외 처리 (예: 콘솔 경고)
            console.warn('logOut 함수를 AuthContext에서 찾을 수 없습니다.');
            router.push('/login'); // 기본적으로 로그인 페이지로 이동 시도
          }
        } else {
          notifications.show({
            title: '코드 사용 성공!',
            message: data.message || `${data.points || (data.newBalance - (data.newBalance - (data.couponData?.points || 0)))} 포인트가 지급되었습니다. 현재 잔액: ${data.newBalance}`,
            color: 'green',
          });
          setCode(''); // 입력 필드 초기화
        }
      } else {
        notifications.show({
          title: '코드 사용 실패',
          message: data.error || '코드를 사용하는데 문제가 발생했습니다.',
          color: 'red',
          icon: <IconAlertCircle />,
        });
      }
    } catch (error) {
      console.error('Redeem API 호출 오류:', error);
      notifications.show({
        title: '오류 발생',
        message: '코드 사용 중 예기치 않은 오류가 발생했습니다.',
        color: 'red',
        icon: <IconAlertCircle />,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <Container size="xs" py="xl">
        <Title order={2} ta="center" mb="xl">
          Redeem 코드 사용
        </Title>
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack>
            <Text ta="center" mb="md">
              Patreon 후원 보상 또는 이벤트로 지급받은 코드를 입력하세요.
            </Text>
            <TextInput
              label="코드 입력"
              placeholder="코드를 입력하세요"
              value={code}
              onChange={(event) => setCode(event.currentTarget.value)} // 코드는 대문자로 통일
              required
              leftSection={<IconTicket size={16} />}
            />
            <Button onClick={handleSubmit} loading={loading} fullWidth mt="md">
              사용하기
            </Button>
          </Stack>
        </Paper>
      </Container>
    </AppShell>
  );
}