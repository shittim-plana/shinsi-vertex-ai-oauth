import { Card, Image, Stack, Group, Text, Divider, Badge, ActionIcon } from '@mantine/core';
import { IconUser, IconMessageCircle, IconHeart, IconHeartFilled } from '@tabler/icons-react';
import { Character } from '@/types/character';
import { formatDate } from '@/utils/dateUtils'; // Import the utility function

interface CharacterInfoCardProps {
  character: Character;
  isLiked: boolean;
  likeLoading: boolean;
  onLike: () => void;
  isLikeDisabled: boolean;
  // Removed formatDate from props
}

export function CharacterInfoCard({
  character,
  isLiked,
  likeLoading,
  onLike,
  isLikeDisabled,
}: CharacterInfoCardProps) {
  // Use the imported formatDate function directly
  return (
    <Card shadow="sm" padding="md" radius="md" withBorder>
      <Card.Section>
        <Image
          src={character.image}
          height={300}
          alt={character.name || '캐릭터 이미지'}
          fit="cover"
          fallbackSrc="https://via.placeholder.com/300x300?text=No+Image"
        />
      </Card.Section>
      <Stack mt="md">
        <Group>
          <IconUser size={16} />
          <Text size="sm">{character.creatorName}</Text>
        </Group>
        <Text size="xs" c="dimmed">
          생성일: {formatDate(character.createdAt)}
        </Text>
        <Group mt="xs">
          <Group gap="xs">
            <IconMessageCircle size={16} color="blue" />
            <Text size="sm">{character.conversationCount || 0} 대화</Text>
          </Group>
          <Group gap="xs">
            <ActionIcon
              variant="subtle"
              color={isLiked ? "red" : "gray"}
              onClick={onLike}
              loading={likeLoading}
              disabled={isLikeDisabled}
              title={isLikeDisabled ? "로그인 필요" : (isLiked ? "좋아요 취소" : "좋아요")}
            >
              {isLiked ? <IconHeartFilled size={16} /> : <IconHeart size={16} />}
            </ActionIcon>
            <Text size="sm">{character.likesCount || 0}</Text>
          </Group>
        </Group>
        <Divider my="xs" />
        <Group>
          {character.tags?.map((tag) => (
            <Badge key={tag} variant="light">
              {tag}
            </Badge>
          ))}
        </Group>
      </Stack>
    </Card>
  );
}