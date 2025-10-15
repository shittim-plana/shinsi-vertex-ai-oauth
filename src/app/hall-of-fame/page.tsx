'use client';

import AppShell from '@/components/layout/AppShell';
import { Container, Title, Text, List, ThemeIcon, Accordion, Badge, Group } from '@mantine/core';
import { IconHeartFilled, IconDiamond, IconCrown, IconStarFilled, IconAward, IconMedal, IconTrophy } from '@tabler/icons-react'; // IconTrophy 추가

// 실제 후원자 데이터 (제공된 목록 기반)
// amount는 달러($) 기준
const sponsors = [
  { id: 'hyunsoo', name: '현수 이', amount: 485 }, // 금액 수정
  { id: 'neko', name: 'Neko Y', amount: 190 },
  { id: 'potato', name: 'Sir Potato', amount: 140 },
  { id: 'jsk', name: 'js k', amount: 100 },
  { id: 'kurumi', name: '쿠루미 토키사키', amount: 100 },
  { id: 'batten', name: 'Batten berg', amount: 95 },
  { id: 'cat', name: '귀여움 고양이', amount: 90 },
  { id: 'ice', name: '아이스', amount: 75 },
  { id: 'rewon', name: '레원 akrurewon 악루', amount: 30 },
  { id: 'leaf', name: 'leaf sun', amount: 10 },
  { id: 'dahun1', name: '다훈 김 (kimdahun001)', amount: 10 },
  { id: 'juchang', name: '주창현 3320', amount: 10 },
  { id: 'dahun2', name: '다훈 김 (kimdahun002)', amount: 5 },
  { id: 'mingyu', name: '민규 박', amount: 5 },
  { id: 'saechi', name: '새치 청', amount: 5 },
  { id: 'junhyeok', name: '준혁 서', amount: 5 },
  { id: 'nyang', name: '츄르도둑 냥이', amount: 5 },
];

// 금액(달러)에 따른 계급 정보 반환 함수
const getTier = (amount: number) => {
  if (amount >= 400) { // 챌린저 등급 추가
    return { name: '챌린저', color: 'cyan', icon: <IconTrophy size={18} /> };
  } else if (amount >= 250) {
    return { name: '다이아몬드', color: 'purple', icon: <IconDiamond size={18} /> };
  } else if (amount >= 100) {
    return { name: '플래티넘', color: 'grape', icon: <IconCrown size={18} /> };
  } else if (amount >= 50) {
    return { name: '골드', color: 'yellow', icon: <IconStarFilled size={18} /> };
  } else if (amount >= 25) {
    return { name: '실버', color: 'gray', icon: <IconAward size={18} /> };
  } else if (amount >= 10) {
    return { name: '브론즈', color: 'orange', icon: <IconMedal size={18} /> };
  } else { // $5 이상
    return { name: '아이언', color: 'teal', icon: <IconHeartFilled size={18} /> };
  }
};

// 계급 순서 정의 (새로운 기준)
const tierOrder = ['챌린저', '다이아몬드', '플래티넘', '골드', '실버', '브론즈', '아이언']; // 챌린저 추가

export default function HallOfFamePage() {
  // 후원자를 금액 기준으로 내림차순 정렬
  const sortedSponsors = [...sponsors].sort((a, b) => b.amount - a.amount);

  // 계급별로 후원자 그룹화
  const sponsorsByTier = sortedSponsors.reduce((acc, sponsor) => {
    const tier = getTier(sponsor.amount).name;
    if (!acc[tier]) {
      acc[tier] = [];
    }
    acc[tier].push(sponsor);
    return acc;
  }, {} as Record<string, typeof sponsors>);

  return (
    <AppShell>
      <Container>
        <Title order={2} mb="lg">
          고마운 분들 (명예의 전당)
        </Title>
        <Text mb="md">
          신시 프로젝트를 후원해주신 모든 분들께 진심으로 감사드립니다. 여러분의 따뜻한 마음 덕분에 프로젝트를 계속 이어나갈 수 있습니다.
        </Text>

        {sortedSponsors.length > 0 ? (
          <Accordion variant="separated" multiple defaultValue={tierOrder}> {/* defaultValue를 tierOrder 전체로 변경 */}
            {tierOrder.map((tierName) => {
              const sponsorsInTier = sponsorsByTier[tierName];
              if (!sponsorsInTier || sponsorsInTier.length === 0) return null; // 해당 계급에 후원자가 없으면 표시 안 함

              const tierInfo = getTier(sponsorsInTier[0].amount); // 첫 번째 후원자 금액으로 계급 정보 가져오기

              return (
                <Accordion.Item key={tierName} value={tierName}>
                  <Accordion.Control icon={tierInfo.icon} style={{ color: `var(--mantine-color-${tierInfo.color}-7)` }}>
                    <Group>
                      <Text fw={500}>{tierName}</Text>
                      <Badge color={tierInfo.color} variant="light">{sponsorsInTier.length}명</Badge>
                    </Group>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <List spacing="xs" size="sm" center>
                      {sponsorsInTier.map((sponsor) => (
                        <List.Item key={sponsor.id} icon={
                          <ThemeIcon color={tierInfo.color} size={24} radius="xl">
                            {tierInfo.icon}
                          </ThemeIcon>
                        }>
                          {sponsor.name} - ${sponsor.amount.toLocaleString()} {/* 금액 단위를 달러($)로 변경 */}
                        </List.Item>
                      ))}
                    </List>
                  </Accordion.Panel>
                </Accordion.Item>
              );
            })}
          </Accordion>
        ) : (
          <Text c="dimmed">아직 후원 내역이 없습니다.</Text>
        )}
      </Container>
    </AppShell>
  );
}