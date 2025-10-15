'use client';

import { Modal, Select, Stack, Button, Title, Group, Switch, ColorInput } from '@mantine/core';
import { useSettings } from '@/contexts/SettingsContext'; // SettingsContext 사용

interface ModelSettingModalProps {
  opened: boolean;
  onClose: () => void;
}

const availableModels = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (무료 (이벤트))' },
  { value: 'gemini-2.5-flash-lite-preview-09-2025', label: 'Gemini 2.5 Flash Lite (무료 (이벤트))' },
  { value: 'deepseek/deepseek-chat-v3-0324', label: 'DeepSeek V3 0324 (무료 (이벤트))' },
  { value: 'openai/gpt-5', label: 'GPT 5 (유료, 포인트 차감 0.4배)' },
  { value: 'openai/gpt-5-chat', label: 'GPT 5 Chat (유료, 포인트 차감 0.4배)' },
  { value: 'gemini-2.5-flash-preview-09-2025', label: 'Gemini 2.5 Flash (유료, 포인트 차감 0.15배)' },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (최신, 포인트 차감 0.65배)' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (유료, 포인트 차감 1.0배)' },
  { value: 'gemini-2.5-flash-preview-04-17', label: 'LearnLM 2.0 Flash Experimental (무료, 포인트 차감 X)' },
  // 필요시 다른 모델 추가
];

export function ModelSettingModal({ opened, onClose }: ModelSettingModalProps) {
  const { settings, updateSettings } = useSettings();

  const handleModelChange = (value: string | null) => {
    if (value) {
      updateSettings({ aiModel: value });
    }
  };

  // Fallback defaults when user settings don't have textColors yet
  const defaultTextColors = {
    light: { normal: '#000000', italic: '#000000', bold: '#000000' },
    dark: { normal: '#ffffff', italic: '#ffffff', bold: '#ffffff' },
  };
  const tc = settings.textColors || defaultTextColors;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="AI 모델 설정"
      centered
      size="md"
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
    >
      <Stack gap="md">
        <Select
          label="사용할 AI 모델을 선택하세요."
          description="모델에 따라 응답 품질 및 포인트 차감 정책이 다를 수 있습니다."
          data={availableModels}
          value={settings.aiModel || 'gemini-2.5-flash-preview-04-17'}
          onChange={handleModelChange}
          withAsterisk
          searchable
          nothingFoundMessage="모델을 찾을 수 없습니다."
        />
        <Switch
          label="말줄임표(...) 제거"
          description="모델 응답에서 ... 를 제거합니다."
          checked={settings.sanitizeEllipsis ?? true}
          onChange={(e) => updateSettings({ sanitizeEllipsis: e.currentTarget.checked })}
        />

        {/* 사용 시 회당 1000포인트 추가 차감 */}
        <Switch
          label="장기기억(LTM) 사용"
          description="룸 전체 과거 대화를 검색해 컨텍스트에 주입합니다."
          checked={Boolean((settings as any).longTermMemoryEnabled ?? (settings as any).enableLongTermMemory ?? false)}
          onChange={(e) => updateSettings({ longTermMemoryEnabled: e.currentTarget.checked, enableLongTermMemory: e.currentTarget.checked })}
          mt="sm"
        />

        <Switch
          label="이미지 숨기기"
          description="생성/갤러리 이미지를 모두 숨깁니다."
          checked={Boolean((settings as any).hideImages)}
          onChange={(e) => updateSettings({ hideImages: e.currentTarget.checked })}
          mt="sm"
        />

        <Title order={5} mt="md">텍스트 색상</Title>
        <Stack gap="sm">
          <Title order={6}>라이트 테마</Title>
          <Group grow>
            <ColorInput
              label="평범한 글씨"
              format="hex"
              value={tc.light.normal}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    light: { ...prev.light, normal: value || '#000000' },
                  },
                });
              }}
            />
            <ColorInput
              label="이텔릭체"
              format="hex"
              value={tc.light.italic}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    light: { ...prev.light, italic: value || '#000000' },
                  },
                });
              }}
            />
            <ColorInput
              label="굵은 글씨"
              format="hex"
              value={tc.light.bold}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    light: { ...prev.light, bold: value || '#000000' },
                  },
                });
              }}
            />
          </Group>

          <Title order={6} mt="sm">다크 테마</Title>
          <Group grow>
            <ColorInput
              label="평범한 글씨"
              format="hex"
              value={tc.dark.normal}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    dark: { ...prev.dark, normal: value || '#ffffff' },
                  },
                });
              }}
            />
            <ColorInput
              label="이텔릭체"
              format="hex"
              value={tc.dark.italic}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    dark: { ...prev.dark, italic: value || '#ffffff' },
                  },
                });
              }}
            />
            <ColorInput
              label="굵은 글씨"
              format="hex"
              value={tc.dark.bold}
              onChange={(value) => {
                const prev = settings.textColors || defaultTextColors;
                updateSettings({
                  textColors: {
                    ...prev,
                    dark: { ...prev.dark, bold: value || '#ffffff' },
                  },
                });
              }}
            />
          </Group>
        </Stack>

        <Group justify="flex-end" mt="lg">
          <Button onClick={onClose}>닫기</Button>
        </Group>
      </Stack>
    </Modal>
  );
}