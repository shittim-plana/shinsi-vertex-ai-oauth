// src/components/ranking/RankingCharacterCard.tsx
'use client';

import { Card, Image, Text, Badge, Group, Stack, Button, Tooltip } from '@mantine/core';
import Link from 'next/link';
import type { CharacterRankingItem, CharacterRankingMetric } from '@/types/ranking';

export function formatNumberCompact(n: number | undefined) {
  if (typeof n !== 'number') return '0';
  return new Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(n);
}

export function RankingCharacterCard({
  item,
  metric,
}: {
  item: CharacterRankingItem;
  metric: CharacterRankingMetric;
}) {
  const name = item.displayName || item.characterId;
  const image = item.avatarUrl || '/window.svg';

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder>
      <Card.Section>
        <Image
          src={image}
          height={160}
          alt={name}
          fallbackSrc="/window.svg"
          style={{ objectFit: 'cover' }}
        />
      </Card.Section>

      <Stack gap="xs" mt="sm">
        <Group justify="space-between" wrap="nowrap">
          <Badge variant="light" color="grape">#{item.rank}</Badge>
          <Group gap={6}>
            <Badge variant={metric === 'played' ? 'filled' : 'light'} color="blue">
              플레이 {formatNumberCompact(item.played)}
            </Badge>
            <Badge variant={metric === 'spent' ? 'filled' : 'light'} color="green">
              소비 {formatNumberCompact(item.spent)}
            </Badge>
          </Group>
        </Group>

        <Tooltip label={name} withArrow openDelay={200}>
          <Text fw={600} truncate="end">{name}</Text>
        </Tooltip>

        <Group justify="space-between">
          <Button
            component={Link}
            href={`/character/${item.characterId}`}
            size="xs"
            variant="light"
            color="blue"
          >
            상세보기
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}