'use client';

import { Title, Text, List, Stack, Divider } from '@mantine/core';

export default function TermsPage() {
  return (
    <Stack gap="xl" p="md">
      <Title order={1} ta="center" mb="lg">
        이용약관
      </Title>

      <Stack gap="md">
        <Title order={2}>1. 서비스 소개 및 정의</Title>
        <Text>
          본 서비스는 AI 채팅 플랫폼으로, 사용자가 AI 캐릭터와 대화를 나눌 수 있는 웹 애플리케이션입니다.
          &ldquo;서비스&rdquo;라 함은 본 플랫폼 및 관련 기능을 의미하며, &ldquo;사용자&rdquo;라 함은 본 서비스를 이용하는 모든 개인을 의미합니다.
        </Text>

        <Title order={2}>2. 계정 및 자격</Title>
        <Text>
          서비스 이용을 위해서는 계정 생성이 필요합니다. 사용자는 정확한 정보를 제공해야 하며,
          계정 정보의 정확성과 보안을 유지할 책임이 있습니다.
        </Text>

        <Title order={2}>3. AI 생성 콘텐츠 면책</Title>
        <Text>
          AI가 생성하는 모든 콘텐츠는 인공지능의 예측에 기반하며, 실제 사실이나 의견을 반영하지 않을 수 있습니다.
          본 서비스는 AI 생성 콘텐츠의 정확성, 적합성, 완전성에 대해 어떠한 보증도 하지 않으며,
          사용자는 이러한 콘텐츠를 신뢰하지 말고 자신의 판단으로 사용해야 합니다.
        </Text>

        <Title order={2}>4. 사용자 의무 및 금지행위</Title>
        <List>
          <List.Item>불법, 유해, 또는 부적절한 콘텐츠 생성 금지</List.Item>
          <List.Item>타인의 권리 침해 금지</List.Item>
          <List.Item>서비스의 정상적인 운영 방해 금지</List.Item>
          <List.Item>계정 정보의 무단 공유 금지</List.Item>
        </List>

        <Title order={2}>5. 결제 및 환불</Title>
        <Text>
          본 서비스는 Stripe를 통한 일회성 결제를 지원합니다. 결제 후 환불은 서비스 이용 시작 전 24시간 이내에만 가능하며,
          이용이 시작된 후에는 환불이 불가능합니다. 환불 정책은 Stripe의 정책을 따릅니다.
        </Text>

        <Title order={2}>6. 멤버십 및 후원</Title>
        <Text>
          Patreon을 통한 멤버십 및 후원 프로그램을 운영합니다. 후원자는 추가 혜택을 받을 수 있으며,
          후원 취소는 Patreon 플랫폼을 통해 직접 처리됩니다.
        </Text>

        <Title order={2}>7. 개인정보 및 보안</Title>
        <Text>
          사용자의 개인정보는 서비스 제공을 위해 수집되며, 관련 법규에 따라 보호됩니다.
          계정 보안을 위해 강력한 비밀번호 사용을 권장하며, 계정 도용 시 즉시 신고해야 합니다.
        </Text>

        <Title order={2}>8. 데이터 보관 및 삭제</Title>
        <Text>
          회원탈퇴 시 모든 사용자 데이터는 즉시 영구 삭제되며, 복구가 불가능합니다.
          데이터 삭제 전 백업을 권장합니다.
        </Text>

        <Title order={2}>9. 책임 제한</Title>
        <Text>
          본 서비스는 &ldquo;있는 그대로&rdquo; 제공되며, 어떠한 명시적 또는 묵시적 보증도 하지 않습니다.
          서비스 이용으로 인한 직접적, 간접적, 부수적 손해에 대해 책임을 지지 않습니다.
        </Text>

        <Title order={2}>10. 손해배상</Title>
        <Text>
          사용자가 본 약관을 위반하여 발생한 손해에 대해 서비스 제공자는 손해배상을 청구할 수 있습니다.
        </Text>

        <Title order={2}>11. 지식재산권</Title>
        <Text>
          본 서비스의 소프트웨어, 디자인, 콘텐츠에 대한 지식재산권은 서비스 제공자에게 있습니다.
          사용자가 생성한 콘텐츠의 권리는 사용자에게 귀속되나, 서비스 개선을 위해 익명화하여 사용할 수 있습니다.
        </Text>

        <Title order={2}>12. 제3자 서비스</Title>
        <Text>
          본 서비스는 Google, Stripe, Patreon 등의 제3자 서비스를 통합합니다.
          이러한 서비스의 이용은 각 서비스의 약관을 따르며, 본 서비스는 제3자 서비스의 성능이나 가용성에 대해 책임지지 않습니다.
        </Text>

        <Title order={2}>13. 약관 변경</Title>
        <Text>
          본 약관은 필요 시 변경될 수 있으며, 변경 사항은 서비스 내 공지 또는 이메일을 통해 사용자에게 통지됩니다.
          변경 후 계속 서비스를 이용하는 것은 변경된 약관에 동의한 것으로 간주됩니다.
        </Text>

        <Title order={2}>14. 해지 및 중지</Title>
        <Text>
          사용자는 언제든지 계정을 삭제할 수 있으며, 서비스 제공자는 부적절한 이용 시 서비스 이용을 중지할 수 있습니다.
        </Text>

        <Title order={2}>15. 준거법 및 분쟁 해결</Title>
        <Text>
          본 약관은 대한민국 법을 준거법으로 하며, 분쟁 발생 시 서울중앙지방법원을 관할 법원으로 합니다.
        </Text>

        <Title order={2}>16. 연락처</Title>
        <Text>
          문의사항은 서비스 내 고객지원 디스코드 채널을 통해 연락주시기 바랍니다.
        </Text>

        <Divider my="lg" />

        <Text ta="center" c="dimmed" size="sm">
          발효일: 2025년 9월 12일<br />
          최종 업데이트: 2025년 9월 12일
        </Text>
      </Stack>
    </Stack>
  );
}