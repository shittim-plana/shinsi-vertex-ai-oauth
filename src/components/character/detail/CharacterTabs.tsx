import { Tabs, Paper, Text, Divider, Grid, Image } from '@mantine/core';
import { Character } from '@/types/character';
import { useAuth } from '@/contexts/AuthContext';

interface CharacterTabsProps {
  character: Character;
}

export function CharacterTabs({ character }: CharacterTabsProps) {
  const { uid } = useAuth(); // 현재 사용자 ID 가져오기
  const hasAdditionalImages = character.additionalImages && character.additionalImages.length > 0;
  const isMyCharacter = character.creatorId === uid; // 캐릭터가 내 캐릭터인지 여부

  return (
    <Tabs defaultValue="description">
      <Tabs.List>
        <Tabs.Tab value="description">설명</Tabs.Tab>
        {isMyCharacter && <Tabs.Tab value="details">상세 설정</Tabs.Tab>}
        {hasAdditionalImages && (
          <Tabs.Tab value="gallery">갤러리</Tabs.Tab>
        )}
      </Tabs.List>

      <Tabs.Panel value="description" pt="md">
        <Paper withBorder p="lg" radius="md">
          <Text fw={500} mb="sm">소개</Text>
          <Text>{character.description}</Text>
          <Divider my="md" />
          <Text fw={500} mb="sm">첫 메시지</Text>
          <Paper p="md" withBorder>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{character.firstMessage}</Text>
          </Paper>
        </Paper>
      </Tabs.Panel>

      <Tabs.Panel value="details" pt="md">
        <Paper withBorder p="lg" radius="md">
          <Text fw={500} mb="sm">캐릭터 상세 설정</Text>
          <Paper p="md" withBorder style={{ maxHeight: '800px', overflow: 'auto' }}>
            <Text style={{ whiteSpace: 'pre-wrap' }}>{character.detail}</Text>
          </Paper>
        </Paper>
      </Tabs.Panel>

      {hasAdditionalImages && (
        <Tabs.Panel value="gallery" pt="md">
          <Paper withBorder p="lg" radius="md">
            <Text fw={500} mb="md">갤러리</Text>
            <Grid>
              {(character.additionalImages ?? []).map((imageUrl, index) => (
                <Grid.Col key={index} span={{ base: 12, sm: 6, md: 4 }}>
                  <Image
                    src={imageUrl}
                    height={200}
                    alt={`${character.name || '캐릭터'} - 이미지 ${index + 1}`}
                    radius="md"
                    fit="cover"
                    fallbackSrc="https://via.placeholder.com/200x200?text=No+Image"
                  />
                </Grid.Col>
              ))}
            </Grid>
          </Paper>
        </Tabs.Panel>
      )}
    </Tabs>
  );
}