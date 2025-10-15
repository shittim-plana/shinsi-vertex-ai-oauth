'use client';

import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Container, Title, Paper, Stack, Group, Text, Switch, PasswordInput, Button, Divider, Alert, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconInfoCircle, IconDeviceFloppy, IconTrash, IconKey, IconShieldLock, IconUserX } from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { db } from '@/firebase/config';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { DeleteAccountModal } from '@/components/modals/DeleteAccountModal';

export default function SettingsPage() {
  const { user, uid } = useAuth();
  const { settings, updateSettings } = useSettings();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleteModalOpened, setDeleteModalOpened] = useState(false);

  // API Keys (stored in users/{uid}.apiKeys)
  const [hasLoaded, setHasLoaded] = useState(false);
  const [googleKey, setGoogleKey] = useState('');
  const [openRouterKey, setOpenRouterKey] = useState('');

  const loadApiKeys = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const uref = doc(db, 'users', uid);
      const snap = await getDoc(uref);
      if (snap.exists()) {
        const data = snap.data() as any;
        const api = data?.apiKeys || {};
        setGoogleKey(api.googleAiStudio || api.google || '');
        setOpenRouterKey(api.openRouter || '');
      }
      setHasLoaded(true);
    } catch (e) {
      console.error('Failed to load API keys:', e);
      notifications.show({
        title: '불러오기 실패',
        message: 'API 키를 불러오는 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (uid && !hasLoaded) {
      loadApiKeys();
    }
  }, [uid, hasLoaded, loadApiKeys]);

  const saveApiKeys = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      const uref = doc(db, 'users', uid);
      // Ensure the user document exists (setDoc with merge)
      await setDoc(
        uref,
        {
          apiKeys: {
            googleAiStudio: googleKey || '',
            openRouter: openRouterKey || '',
          },
        },
        { merge: true },
      );
      notifications.show({
        title: '저장됨',
        message: 'API 키가 저장되었습니다.',
        color: 'green',
        icon: <IconDeviceFloppy size={16} />,
      });
    } catch (e) {
      console.error('Failed to save API keys:', e);
      notifications.show({
        title: '저장 실패',
        message: 'API 키 저장 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const clearApiKeys = async () => {
    if (!uid) return;
    setSaving(true);
    try {
      const uref = doc(db, 'users', uid);
      await updateDoc(uref, {
        apiKeys: {
          googleAiStudio: '',
          openRouter: '',
        },
      });
      setGoogleKey('');
      setOpenRouterKey('');
      notifications.show({
        title: '초기화됨',
        message: 'API 키가 초기화되었습니다.',
        color: 'orange',
        icon: <IconTrash size={16} />,
      });
    } catch (e) {
      console.error('Failed to clear API keys:', e);
      notifications.show({
        title: '초기화 실패',
        message: 'API 키 초기화 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleUseUserKeys = (checked: boolean) => {
    updateSettings({ useUserApiKeys: checked }).catch((e) => {
      console.error('Failed to update useUserApiKeys:', e);
      notifications.show({
        title: '설정 변경 실패',
        message: 'API 키 사용 설정 변경 중 오류가 발생했습니다.',
        color: 'red',
      });
    });
  };

  if (!user) {
    return (
      <AppShell>
        <Container size="lg" py="xl">
          <Text ta="center" py="xl">로그인이 필요합니다...</Text>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Container size="lg" py="xl">
        <Title order={2} mb="lg">설정</Title>

        <Paper withBorder shadow="sm" p="xl" radius="md" mb="xl">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <div>
                <Text fw={600}>개인 API 키 사용</Text>
                <Text size="sm" c="dimmed">
                  본인 소유의 API 키(Google AI Studio, OpenRouter 등)를 우선 사용합니다. 꺼두면 서비스 기본 키를 사용합니다.
                </Text>
              </div>
              <Switch
                checked={Boolean(settings.useUserApiKeys)}
                onChange={(e) => toggleUseUserKeys(e.currentTarget.checked)}
              />
            </Group>

            <Alert color="gray" variant="light" icon={<IconInfoCircle size={16} />}>
              <Stack gap={4}>
                <Text size="sm">API 키는 사용자의 Firestore 사용자 문서에 암호화 없이 저장됩니다. 민감한 키를 저장할지 신중히 결정하세요.</Text>
                <Text size="sm">서비스 키 대비 할당/요금/쿼터 정책이 달라질 수 있습니다.</Text>
              </Stack>
            </Alert>

            <Divider my="sm" />

            <Group gap="md" align="flex-end">
              <Stack gap={6} style={{ flex: 1 }}>
                <Group gap="xs">
                  <IconKey size={16} />
                  <Text fw={600} size="sm">Google AI Studio API Key</Text>
                </Group>
                <PasswordInput
                  placeholder="AIza... (Google AI Studio)"
                  leftSection={<IconShieldLock size={16} />}
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.currentTarget.value)}
                  disabled={loading}
                />
                <Text size="xs" c="dimmed">Gemini/Vertex 호출용. users/{'{uid}'}/apiKeys.googleAiStudio</Text>
              </Stack>

              <Stack gap={6} style={{ flex: 1 }}>
                <Group gap="xs">
                  <IconKey size={16} />
                  <Text fw={600} size="sm">OpenRouter API Key</Text>
                </Group>
                <PasswordInput
                  placeholder="sk-or-v1-... (OpenRouter)"
                  leftSection={<IconShieldLock size={16} />}
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.currentTarget.value)}
                  disabled={loading}
                />
                <Text size="xs" c="dimmed">OpenRouter 경유 모델 호출용. users/{'{uid}'}/apiKeys.openRouter</Text>
              </Stack>
            </Group>

            <Group justify="flex-end" mt="md">
              <Tooltip label="입력값 초기화">
                <Button variant="outline" color="red" onClick={clearApiKeys} loading={saving} leftSection={<IconTrash size={16} />}>
                  초기화
                </Button>
              </Tooltip>
              <Button color="blue" onClick={saveApiKeys} loading={saving} leftSection={<IconDeviceFloppy size={16} />}>
                저장
              </Button>
            </Group>

            <Divider my="sm" />

            <Alert variant="light" color="blue" title="동작 방식" icon={<IconInfoCircle size={16} />}>
              <Stack gap={4}>
                <Text size="sm">• API 키 사용 토글이 켜져 있으면, 사용자 키 - 환경변수 키 - 서비스 기본 키 순으로 시도합니다.</Text>
                <Text size="sm">• 현재 적용 대상: 대화 생성, 이미지 프롬프트 생성, 로어 생성 호출 경로.</Text>
              </Stack>
            </Alert>
          </Stack>
        </Paper>

        <Paper withBorder shadow="sm" p="xl" radius="md" mb="xl">
          <Stack gap="md">
            <Group justify="space-between" align="center">
              <div>
                <Text fw={600} c="red">회원탈퇴</Text>
                <Text size="sm" c="dimmed">
                  이 작업은 영구적이며 복구할 수 없습니다. 모든 데이터가 즉시 삭제됩니다.
                </Text>
              </div>
              <Button
                color="red"
                variant="outline"
                leftSection={<IconUserX size={16} />}
                onClick={() => setDeleteModalOpened(true)}
              >
                회원탈퇴
              </Button>
            </Group>
          </Stack>
        </Paper>

        <DeleteAccountModal
          opened={deleteModalOpened}
          onClose={() => setDeleteModalOpened(false)}
          onDeleted={() => setDeleteModalOpened(false)}
        />
      </Container>
    </AppShell>
  );
}