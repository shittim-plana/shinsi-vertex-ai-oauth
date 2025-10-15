'use client';

import { Modal, Text, Group, Stack, Divider, Slider, Switch, NumberInput, Checkbox } from '@mantine/core';
import { useSettings } from '@/contexts/SettingsContext';

interface SettingsModalProps {
  opened: boolean;
  onClose: () => void;
}

export function SettingsModal({ opened, onClose }: SettingsModalProps) {
  const { settings, membershipTier, updateSettings, refetchSettings } = useSettings();

  const maxMemory = Infinity

  return (
    <Modal 
      opened={opened} 
      onClose={onClose} 
      title="설정" 
      size="md"
      centered
    >
      <Stack>
        <Text fw={500} mb="xs">채팅 설정</Text>
        
        <Stack gap="md"> {/* Increased gap */}
          <NumberInput
            label="채팅 기억력 (메시지 수)"
            description="캐릭터가 기억할 최대 메시지 수입니다."
            step={1}
            max={isFinite(maxMemory) ? maxMemory : undefined}
            value={settings.memoryCapacity}
            onChange={(value) => updateSettings({ memoryCapacity: Number(value) || 0 })}
            allowDecimal={false}
          />
          <Checkbox
            label="모든 대화 기억하기 (기억력 0으로 설정)"
            checked={settings.memoryCapacity <= 0}
            onChange={(event) => {
              updateSettings({ memoryCapacity: event.currentTarget.checked ? 0 : 5 }); // Set to 0 if checked, default 5 if unchecked
            }}
            mb="md"
          />
        </Stack>
        
          <Switch
            label="채팅 입력창에 페르소나 선택 표시"
            checked={settings.showPersonaSelector}
            onChange={(event) => updateSettings({ showPersonaSelector: event.currentTarget.checked })}
            mt="sm" // Add some margin top for spacing
          />

          <Switch
            label="RP 모드 활성화 (비활성화 시 소설 모드)"
            checked={settings.promptMode === 'rp'}
            onChange={(event) => updateSettings({ promptMode: event.currentTarget.checked ? 'rp' : 'novel' })}
            mt="sm"
          />
          <Switch
            label="채팅 입력창에 입력 내용 개선하기 버튼 표시"
            checked={settings.showRefineButton}
            onChange={(event) => updateSettings({ showRefineButton: event.currentTarget.checked })}
            mt="sm" // Add some margin top for spacing
          />
          <Switch
            label="메시지 앞에 이미지 생성 (NovelAI) (10000포인트 소모)"
            description="메시지를 보낼 때 NovelAI를 사용하여 관련 이미지를 생성합니다."
            checked={settings.enableImageGeneration}
            onChange={(event) => updateSettings({ enableImageGeneration: event.currentTarget.checked })}
            mt="sm"
          />
          {/* <Switch
            label="채팅 요약 활성화"
            description="오래된 메시지를 요약하여 채팅 기억력을 절약합니다."
            checked={settings.enableSummarization}
            onChange={(event) => updateSettings({ enableSummarization: event.currentTarget.checked })}
            mt="sm"
          /> */}
        <Divider my="md" />

        <Stack gap="xs">
          <Text fw={500} mb="xs">테마 설정</Text>
          <Group justify="space-between">
            <Text size="sm">다크 모드</Text>
            <Switch
              checked={settings.theme === 'dark'}
              onChange={async (event) => { // Make handler async
                const newTheme = event.currentTarget.checked ? 'dark' : 'light';
                try {
                  console.log("Updating theme to:", newTheme); // Debug log
                  await updateSettings({ theme: newTheme }); // Wait for update
                  await refetchSettings(); // Refetch settings from Firestore
                } catch (error) {
                  console.error("Failed to update theme and refetch:", error);
                  // Optionally show an error message to the user
                }
              }}
              aria-label="다크 모드 토글"
            />
          </Group>
        </Stack>
      </Stack>
    </Modal>
  );
}

export default SettingsModal;