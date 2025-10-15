import { Title, Group, Badge, Button, Stack } from '@mantine/core';
import { IconEdit, IconMessage, IconTrash } from '@tabler/icons-react';
import { Character } from '@/types/character';

interface CharacterDetailHeaderProps {
  character: Character;
  isOwner: boolean;
  onEdit: () => void;
  onStartChat: () => void;
  onDelete?: () => void;
  isChatDisabled: boolean;
}

export function CharacterDetailHeader({
  character,
  isOwner,
  onEdit,
  onStartChat,
  onDelete,
  isChatDisabled,
}: CharacterDetailHeaderProps) {
  return (
    <Group justify="space-between" align="flex-start">
      <Stack gap="xs">
        <Title order={2}>{character.name}</Title>
        <Group>
          <Badge color={character.isPublic ? 'green' : 'gray'}>
            {character.isPublic ? '공개' : '비공개'}
          </Badge>
          {character.isNSFW && (
            <Badge color="red">NSFW</Badge>
          )}
        </Group>
      </Stack>
      <Group>
        {isOwner && (
          <Button
            variant="light"
            color="blue"
            leftSection={<IconEdit size={16} />}
            onClick={onEdit}
          >
            수정
          </Button>
        )}
        {isOwner && onDelete && (
          <Button
            variant="light"
            color="red"
            leftSection={<IconTrash size={16} />}
            onClick={onDelete}
          >
            삭제
          </Button>
        )}
        <Button
          leftSection={<IconMessage size={16} />}
          onClick={onStartChat}
          disabled={isChatDisabled}
          title={isChatDisabled ? "로그인 후 이용 가능합니다" : ""}
        >
          대화하기
        </Button>
      </Group>
    </Group>
  );
}