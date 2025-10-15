'use client';

import { Checkbox, Card, Image, Text, Badge, Group, Stack } from '@mantine/core';
import { IconUser } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface CharacterSelectorProps {
  character: Character;
  selected: boolean;
  onSelectionChange: (characterId: string, selected: boolean) => void;
  disabled?: boolean;
}

export function CharacterSelector({ 
  character, 
  selected, 
  onSelectionChange, 
  disabled = false 
}: CharacterSelectorProps) {
  const handleSelectionChange = (checked: boolean) => {
    onSelectionChange(character.id, checked);
  };

  return (
    <Card 
      shadow="sm" 
      padding="lg" 
      radius="md" 
      withBorder
      style={{
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: selected ? '2px solid var(--mantine-color-blue-6)' : undefined,
        backgroundColor: selected ? 'var(--mantine-color-blue-0)' : undefined
      }}
      onClick={() => !disabled && handleSelectionChange(!selected)}
    >
      <Card.Section>
        <div style={{ position: 'relative' }}>
          <Image
            src={character.image}
            height={160}
            alt={character.name}
            fallbackSrc="https://placehold.co/600x400?text=No+Image"
          />
          <Checkbox
            checked={selected}
            onChange={(event) => handleSelectionChange(event.currentTarget.checked)}
            disabled={disabled}
            style={{
              position: 'absolute',
              top: '8px',
              left: '8px',
              backgroundColor: 'white',
              borderRadius: '4px',
              padding: '2px'
            }}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      </Card.Section>

      <Group justify="space-between" mt="md" mb="xs">
        <Text fw={500} truncate="end">{character.name}</Text>
        <Group gap={5}>
          {!character.isPublic && (
            <Badge color="gray" variant="light">
              비공개
            </Badge>
          )}
          {character.isNSFW && (
            <Badge color="red" variant="light">
              NSFW
            </Badge>
          )}
        </Group>
      </Group>

      <Text size="sm" c="dimmed" lineClamp={2}>
        {character.description}
      </Text>

      <Group mt="md">
        {character.tags.slice(0, 3).map((tag: string) => (
          <Badge key={tag} variant="light" maw={100}>
            <Text truncate="end" size="xs">{tag}</Text>
          </Badge>
        ))}
        {character.tags.length > 3 && (
          <Badge variant="light">
            <Text truncate="end" size="xs">+{character.tags.length - 3}</Text>
          </Badge>
        )}
      </Group>

      <Group mt="md" justify="space-between" align="center">
        <Text size="xs" c="dimmed" component="div" truncate="end">
          <Group gap={5} align="center" wrap="nowrap">
            <IconUser size={14} />
            {character.creatorName || 'Unknown'}
          </Group>
        </Text>
      </Group>

      <Group mt="xs" justify="space-between">
        <Group gap={4}>
          <Text size="xs" c="dimmed">💬 {character.conversationCount ?? 0}</Text>
        </Group>
        <Group gap={4}>
          <Text size="xs" c="dimmed">❤️ {character.likesCount ?? 0}</Text>
        </Group>
      </Group>
    </Card>
  );
}