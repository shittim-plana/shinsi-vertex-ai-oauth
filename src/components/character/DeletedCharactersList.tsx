'use client';

import { useState, useEffect } from 'react';
import { 
  Container, 
  Title, 
  Grid, 
  Card, 
  Image, 
  Text, 
  Badge, 
  Group, 
  Button, 
  Modal,
  Stack,
  Paper,
  Alert,
  ActionIcon,
  Tooltip
} from '@mantine/core';
import { 
  IconRestore, 
  IconTrashX, 
  IconCalendar, 
  IconAlertTriangle,
  IconInfoCircle
} from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { Character } from '@/types/character';
import { formatDate } from '@/utils/dateUtils';

interface DeletedCharactersListProps {
  characters: Character[];
  onRestore: (character: Character) => Promise<void>;
  onPermanentDelete: (character: Character) => Promise<void>;
  loading?: boolean;
}

export function DeletedCharactersList({ 
  characters, 
  onRestore, 
  onPermanentDelete,
  loading = false 
}: DeletedCharactersListProps) {
  const [selectedCharacter, setSelectedCharacter] = useState<Character | null>(null);
  const [restoreModalOpened, { open: openRestoreModal, close: closeRestoreModal }] = useDisclosure(false);
  const [permanentDeleteModalOpened, { open: openPermanentDeleteModal, close: closePermanentDeleteModal }] = useDisclosure(false);

  const getDaysUntilPermanentDeletion = (deletedAt: Date) => {
    const deletionDate = new Date(deletedAt);
    const permanentDeletionDate = new Date(deletionDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30일 후
    const now = new Date();
    const daysLeft = Math.ceil((permanentDeletionDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
    return Math.max(0, daysLeft);
  };

  const handleRestore = async () => {
    if (!selectedCharacter) return;
    
    try {
      await onRestore(selectedCharacter);
      notifications.show({
        title: '복구 완료',
        message: `${selectedCharacter.name} 캐릭터가 복구되었습니다.`,
        color: 'green',
      });
      closeRestoreModal();
    } catch (error) {
      console.error('복구 실패:', error);
      notifications.show({
        title: '복구 실패',
        message: '캐릭터 복구 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  const handlePermanentDelete = async () => {
    if (!selectedCharacter) return;
    
    try {
      await onPermanentDelete(selectedCharacter);
      notifications.show({
        title: '영구 삭제 완료',
        message: `${selectedCharacter.name} 캐릭터가 영구적으로 삭제되었습니다.`,
        color: 'red',
      });
      closePermanentDeleteModal();
    } catch (error) {
      console.error('영구 삭제 실패:', error);
      notifications.show({
        title: '영구 삭제 실패',
        message: '캐릭터 영구 삭제 중 오류가 발생했습니다.',
        color: 'red',
      });
    }
  };

  if (characters.length === 0) {
    return (
      <Paper withBorder p="xl" radius="md">
        <Stack align="center" gap="md">
          <IconInfoCircle size={48} color="gray" />
          <Text ta="center" fw={500} c="dimmed">
            삭제된 캐릭터가 없습니다
          </Text>
          <Text ta="center" size="sm" c="dimmed">
            삭제된 캐릭터는 여기에 표시되며, 30일 후 자동으로 영구 삭제됩니다.
          </Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Container size="lg">
      <Alert 
        icon={<IconAlertTriangle size={16} />} 
        color="orange" 
        variant="light"
        mb="lg"
      >
        삭제된 캐릭터는 30일 후 자동으로 영구 삭제됩니다. 
        복구하려면 영구 삭제 전에 복구 버튼을 클릭하세요.
      </Alert>

      <Grid>
        {characters.map((character) => {
          const daysLeft = character.deletedAt ? getDaysUntilPermanentDeletion(character.deletedAt) : 0;
          const isExpiringSoon = daysLeft <= 7;
          
          return (
            <Grid.Col key={character.id} span={{ base: 12, sm: 6, lg: 4 }}>
              <Card 
                shadow="sm" 
                padding="lg" 
                radius="md" 
                withBorder
                style={{ 
                  opacity: 0.8,
                  border: isExpiringSoon ? '2px solid var(--mantine-color-red-6)' : undefined
                }}
              >
                <Card.Section>
                  <div style={{ position: 'relative' }}>
                    <Image
                      src={character.image}
                      height={160}
                      alt={character.name}
                      fallbackSrc="https://placehold.co/600x400?text=No+Image"
                      style={{ filter: 'grayscale(50%)' }}
                    />
                    <Badge
                      color="red"
                      variant="filled"
                      style={{
                        position: 'absolute',
                        top: '8px',
                        right: '8px'
                      }}
                    >
                      삭제됨
                    </Badge>
                  </div>
                </Card.Section>

                <Group justify="space-between" mt="md" mb="xs">
                  <Text fw={500} truncate="end">{character.name}</Text>
                  <Group gap={5}>
                    {!character.isPublic && (
                      <Badge color="gray" variant="light" size="xs">
                        비공개
                      </Badge>
                    )}
                    {character.isNSFW && (
                      <Badge color="red" variant="light" size="xs">
                        NSFW
                      </Badge>
                    )}
                  </Group>
                </Group>

                <Text size="sm" c="dimmed" lineClamp={2}>
                  {character.description}
                </Text>

                {character.deletionReason && (
                  <Text size="xs" c="orange" mt="xs" style={{ fontStyle: 'italic' }}>
                    삭제 사유: {character.deletionReason}
                  </Text>
                )}

                <Group mt="md" justify="space-between" align="center">
                  <Group gap={4}>
                    <IconCalendar size={14} />
                    <Text size="xs" c="dimmed">
                      삭제: {character.deletedAt ? formatDate(character.deletedAt) : '알 수 없음'}
                    </Text>
                  </Group>
                </Group>

                <Alert
                  color={isExpiringSoon ? 'red' : 'orange'}
                  variant="light"
                  mt="sm"
                >
                  <Text size="xs">
                    {daysLeft > 0 
                      ? `${daysLeft}일 후 영구 삭제`
                      : '곧 영구 삭제됨'
                    }
                  </Text>
                </Alert>

                <Group mt="md" justify="space-between">
                  <Button
                    variant="light"
                    color="green"
                    size="sm"
                    leftSection={<IconRestore size={16} />}
                    onClick={() => {
                      setSelectedCharacter(character);
                      openRestoreModal();
                    }}
                    disabled={loading}
                  >
                    복구
                  </Button>

                  <Tooltip label="영구 삭제">
                    <ActionIcon
                      variant="light"
                      color="red"
                      size="sm"
                      onClick={() => {
                        setSelectedCharacter(character);
                        openPermanentDeleteModal();
                      }}
                      disabled={loading}
                    >
                      <IconTrashX size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Card>
            </Grid.Col>
          );
        })}
      </Grid>

      {/* Restore Confirmation Modal */}
      <Modal
        opened={restoreModalOpened}
        onClose={closeRestoreModal}
        title="캐릭터 복구"
        centered
      >
        <Stack gap="md">
          <Text>
            <Text span fw={600}>{selectedCharacter?.name}</Text> 캐릭터를 복구하시겠습니까?
          </Text>
          <Text size="sm" c="dimmed">
            복구된 캐릭터는 다시 목록에 표시되고 정상적으로 사용할 수 있습니다.
          </Text>
          
          <Group justify="flex-end">
            <Button variant="default" onClick={closeRestoreModal}>
              취소
            </Button>
            <Button 
              color="green" 
              onClick={handleRestore}
              loading={loading}
              leftSection={<IconRestore size={16} />}
            >
              복구
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Permanent Delete Confirmation Modal */}
      <Modal
        opened={permanentDeleteModalOpened}
        onClose={closePermanentDeleteModal}
        title="영구 삭제 확인"
        centered
      >
        <Stack gap="md">
          <Alert icon={<IconAlertTriangle size={16} />} color="red" variant="light">
            <Text fw={600}>주의: 이 작업은 되돌릴 수 없습니다!</Text>
          </Alert>
          
          <Text>
            <Text span fw={600}>{selectedCharacter?.name}</Text> 캐릭터를 영구적으로 삭제하시겠습니까?
          </Text>
          <Text size="sm" c="dimmed">
            영구 삭제된 캐릭터는 복구할 수 없으며, 모든 관련 데이터가 완전히 제거됩니다.
          </Text>
          
          <Group justify="flex-end">
            <Button variant="default" onClick={closePermanentDeleteModal}>
              취소
            </Button>
            <Button 
              color="red" 
              onClick={handlePermanentDelete}
              loading={loading}
              leftSection={<IconTrashX size={16} />}
            >
              영구 삭제
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Container>
  );
}