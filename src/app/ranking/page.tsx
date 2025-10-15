'use client';

import { useMemo, useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
/* removed useRankings (user tab deprecated) */
import { useCharacterRankings } from '@/hooks/useCharacterRankings';
import type { RankingPeriod, CharacterRankingMetric } from '@/types/ranking';
import {
  Alert,
  Box,
  Button,
  Center,
  Container,
  Group,
  Loader,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Title,
  Grid,
} from '@mantine/core';
import { IconAlertCircle, IconTrophy } from '@tabler/icons-react';
import { RankingCharacterCard } from '@/components/ranking/RankingCharacterCard';

function formatNumber(n: number | undefined) {
  if (typeof n !== 'number') return '-';
  return n.toLocaleString('ko-KR');
}

export default function RankingPage() {
  // user view removed
  const [period, setPeriod] = useState<RankingPeriod>('daily');
  const [limit, setLimit] = useState<number>(100);
  const [metric, setMetric] = useState<CharacterRankingMetric>('played');

  // Fetch both; render based on view (hooks call order 유지)
  // const userQuery = useRankings(period, undefined, { limit }); // removed
  const charQuery = useCharacterRankings(period, metric, undefined, { limit });

  const limitOptions = useMemo(
    () => [
      { value: '50', label: '50' },
      { value: '100', label: '100' },
      { value: '150', label: '150' },
      { value: '200', label: '200' },
    ],
    []
  );

  const metricOptions = useMemo(
      () => [
        { value: 'played', label: '플레이(건수)' },
        { value: 'spent', label: '소비(spent)' },
      ],
      []
    );

  return (
    <AppShell>
      <Container size="lg" py="md">
        <Group justify="space-between" align="center" mb="md">
          <Group gap="xs">
            <IconTrophy size={24} />
            <Title order={3}>랭킹</Title>
          </Group>

          <Group gap="sm">
            <Text size="sm" c="dimmed">
              표시 개수
            </Text>
            <Select
              aria-label="표시 개수 선택"
              data={limitOptions}
              value={String(limit)}
              onChange={(v) => {
                const next = parseInt(v || '100', 10);
                const clamped = Math.max(1, Math.min(200, next));
                setLimit(clamped);
              }}
              w={100}
            />
          </Group>
        </Group>

        {/* 캐릭터 랭킹 전용 화면 (사용자 탭 제거) */}
        <Group justify="flex-end" mb="sm">
          <Group gap="xs">
            <Text size="sm" c="dimmed">지표</Text>
            <Select
              aria-label="캐릭터 랭킹 지표 선택"
              data={metricOptions}
              value={metric}
              onChange={(v) => setMetric(((v as CharacterRankingMetric) || 'played'))}
              w={160}
            />
          </Group>
        </Group>

        <PeriodTabs
          period={period}
          onChangePeriod={setPeriod}
          render={(current) => (
            <CharacterPeriodPanel
              period={current}
              loading={charQuery.loading}
              error={charQuery.error}
              items={
                ((charQuery.data?.items ?? []) as any[]).map((it: any) => ({
                  rank: it.rank,
                  characterId: it.characterId,
                  displayName: it.displayName,
                  earned: it.earned,
                  net: it.net,
                  spent: it.spent,
                  played: it.played,
                  avatarUrl: it.avatarUrl,
                }))
              }
              metaPeriodKey={charQuery.data?.metadata?.periodKey}
              onRetry={charQuery.refetch}
              metric={metric}
            />
          )}
        />
      </Container>
    </AppShell>
  );
}

/**
 * 기간 탭 공통 컨테이너
 */
function PeriodTabs({
  period,
  onChangePeriod,
  render,
}: {
  period: RankingPeriod;
  onChangePeriod: (p: RankingPeriod) => void;
  render: (p: RankingPeriod) => React.ReactNode;
}) {
  return (
    <Tabs value={period} onChange={(v) => onChangePeriod((v as RankingPeriod) ?? 'daily')} keepMounted={false}>
      <Tabs.List role="tablist">
        <Tabs.Tab value="daily" role="tab" aria-label="일간">일간</Tabs.Tab>
        <Tabs.Tab value="weekly" role="tab" aria-label="주간">주간</Tabs.Tab>
        <Tabs.Tab value="monthly" role="tab" aria-label="월간">월간</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="daily" pt="md">
        {render('daily')}
      </Tabs.Panel>
      <Tabs.Panel value="weekly" pt="md">
        {render('weekly')}
      </Tabs.Panel>
      <Tabs.Panel value="monthly" pt="md">
        {render('monthly')}
      </Tabs.Panel>
    </Tabs>
  );
}

/** UserPeriodPanel removed (user tab deprecated). */

function CharacterPeriodPanel({
  period,
  loading,
  error,
  items,
  metaPeriodKey,
  onRetry,
  metric,
}: {
  period: RankingPeriod;
  loading: boolean;
  error: string | null;
  items: Array<{
    rank: number;
    characterId: string;
    displayName?: string;
    earned: number;
    net: number;
    spent: number;
    played: number;
    avatarUrl?: string;
  }>;
  metaPeriodKey?: string;
  onRetry: () => Promise<void>;
  metric: CharacterRankingMetric;
}) {
  if (loading) {
    return (
      <Paper withBorder p="md">
        <Center mih={200}>
          <Stack align="center" gap="xs">
            <Loader />
            <Text c="dimmed">불러오는 중...</Text>
          </Stack>
        </Center>
      </Paper>
    );
  }

  if (error) {
    return (
      <Alert color="red" variant="light" title="오류" icon={<IconAlertCircle />} mb="md">
        <Stack gap="xs">
          <Text>랭킹을 불러오지 못했습니다.</Text>
          <Box>
            <Button onClick={onRetry} variant="filled">재시도</Button>
          </Box>
        </Stack>
      </Alert>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Paper withBorder p="md">
        <Center mih={120}>
          <Text c="dimmed">집계된 캐릭터 랭킹이 없습니다.</Text>
        </Center>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      {metaPeriodKey && (
        <Text size="sm" c="dimmed">
          최근 집계 키: {metaPeriodKey} · 지표: {metric}
        </Text>
      )}

      <Grid gutter="md">
        {items.map((it) => (
          <Grid.Col key={`${it.characterId}-${it.rank}`} span={{ base: 12, sm: 6, md: 3 }}>
            <RankingCharacterCard item={it as any} metric={metric} />
          </Grid.Col>
        ))}
      </Grid>
    </Stack>
  );
}