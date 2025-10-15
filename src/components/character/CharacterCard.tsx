import { Card, Image, Text, Badge, Group, Button } from '@mantine/core';
import { IconUser } from '@tabler/icons-react';
import { useRouter } from 'next/navigation';
import type { Character } from '../../types/character';
import { QuickDeleteButton } from './QuickDeleteButton';

interface CharacterCardProps {
  character: Character;
  onDelete?: (character: Character) => void;
  showDeleteButton?: boolean;
}

export function CharacterCard({ character, onDelete, showDeleteButton = false }: CharacterCardProps) {
  const router = useRouter();

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Card.Section>
        <Image
          src={character.image}
          height={160}
          alt={character.name}
          fallbackSrc="https://placehold.co/600x400?text=No+Image" // Placeholder 이미지 URL
        />
      </Card.Section>

      <Group justify="space-between" mt="md" mb="xs">
        <Text fw={500} truncate="end">{character.name}</Text> {/* 이름이 길 경우 잘라내기 */}
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
            <Text truncate="end" size="xs">{tag}</Text> {/* Text 컴포넌트로 감싸서 truncate 적용 */}
          </Badge>
        ))}
        {character.tags.length > 3 && (
          <Badge variant="light"><Text truncate="end" size="xs">+{character.tags.length - 3}</Text></Badge>
        )}
      </Group>

      <Group mt="md" justify="space-between" align="center">
        <Text size="xs" c="dimmed" component="div" truncate="end"> {/* 제작자 이름 길 경우 잘라내기 */}
          <Group gap={5} align="center" wrap="nowrap">
            <IconUser size={14} />
            {character.creatorName || 'Unknown'} {/* 기본값 추가 */}
          </Group>
        </Text>

        <Group gap="xs">
          <Button
            variant="light"
            color="blue"
            size="xs"
            onClick={() => router.push(`/character/${character.id}`)}
          >
            상세보기
          </Button>
          
          {showDeleteButton && onDelete && (
            <QuickDeleteButton
              character={character}
              onDelete={onDelete}
              variant="icon"
              size="xs"
            />
          )}
        </Group>
      </Group>

      <Group mt="xs" justify="space-between">
        <Group gap={4}>
          <Text size="xs" c="dimmed">💬 {character.conversationCount ?? 0}</Text> {/* 기본값 추가 */}
        </Group>
        <Group gap={4}>
          <Text size="xs" c="dimmed">❤️ {character.likesCount ?? 0}</Text> {/* 기본값 추가 */}
        </Group>
      </Group>
    </Card>
  );
}