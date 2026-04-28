'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Paper,
  Stack,
  Group,
  Text,
  TextInput,
  Select,
  Button,
  Badge,
  Alert,
  Divider,
  List,
  ThemeIcon,
  Switch,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCloud, IconCloudOff, IconInfoCircle, IconCheck, IconX, IconShieldCheck } from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/firebase/config';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import type { VerifyResult } from '@/app/api/vertex-ai/verify/route';

// global은 의도적인 기본값: gemini-2.5-pro-preview 등 Preview 모델은 리전 선택이 불가하여
// global 엔드포인트(https://aiplatform.googleapis.com)만 지원한다. 임의로 변경 금지.
const DEFAULT_REGION = 'global';

const REGION_OPTIONS = [
  { value: 'global', label: 'global (Preview 모델 전용 — gemini-2.5-pro-preview 등)' },
  { value: 'us-central1', label: 'us-central1 (Iowa)' },
  { value: 'us-east4', label: 'us-east4 (Virginia)' },
  { value: 'us-west1', label: 'us-west1 (Oregon)' },
  { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { value: 'europe-west4', label: 'europe-west4 (Netherlands)' },
  { value: 'asia-northeast1', label: 'asia-northeast1 (Tokyo)' },
  { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore)' },
];

interface VertexAIData {
  gcpProjectId?: string;
  region?: string;
  connectedAt?: number;
  refreshToken?: string;
  tokenExpiresAt?: number;
  /** false로 명시된 경우에만 비활성화. 미설정(undefined)은 활성화로 취급. */
  enabled?: boolean;
}

export function VertexAIConnection() {
  const { uid } = useAuth();
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [vertexData, setVertexData] = useState<VertexAIData | null>(null);

  // Form state (before connection)
  const [projectId, setProjectId] = useState('');
  const [region, setRegion] = useState<string>(DEFAULT_REGION);

  // Project list (after connection)
  const [projects, setProjects] = useState<Array<{ projectId: string; name: string }>>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Integrity check state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);

  const loadVertexAIData = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const userDocRef = doc(db, 'users', uid);
      const snap = await getDoc(userDocRef);
      if (snap.exists()) {
        const data = snap.data();
        if (data?.vertexAI?.refreshToken) {
          setVertexData(data.vertexAI as VertexAIData);
        } else {
          setVertexData(null);
        }
      }
    } catch (e) {
      console.error('Failed to load Vertex AI data:', e);
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    loadVertexAIData();
  }, [loadVertexAIData]);

  // Check URL params for OAuth callback status
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('vertex_ai_status');
    if (status === 'success') {
      notifications.show({
        title: 'Vertex AI 연결됨',
        message: 'GCP 계정이 성공적으로 연결되었습니다.',
        color: 'green',
      });
      loadVertexAIData();
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('vertex_ai_status');
      window.history.replaceState({}, '', url.toString());
    } else if (status === 'error') {
      const message = params.get('vertex_ai_message') || '연결 중 오류가 발생했습니다.';
      notifications.show({
        title: 'Vertex AI 연결 실패',
        message: decodeURIComponent(message),
        color: 'red',
      });
      const url = new URL(window.location.href);
      url.searchParams.delete('vertex_ai_status');
      url.searchParams.delete('vertex_ai_message');
      window.history.replaceState({}, '', url.toString());
    }
  }, [loadVertexAIData]);

  const handleConnect = () => {
    if (!uid) return;
    const params = new URLSearchParams({
      uid,
      projectId: projectId.trim(),
      region,
    });
    window.location.href = `/api/vertex-ai/auth?${params.toString()}`;
  };

  const handleDisconnect = async () => {
    if (!uid) return;
    setDisconnecting(true);
    try {
      const res = await fetch('/api/vertex-ai/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as Record<string, string>)?.error || 'Disconnect failed');
      }

      setVertexData(null);
      notifications.show({
        title: 'Vertex AI 연결 해제됨',
        message: 'GCP 계정 연결이 해제되었습니다.',
        color: 'orange',
        icon: <IconCloudOff size={16} />,
      });
    } catch (e) {
      console.error('Failed to disconnect Vertex AI:', e);
      notifications.show({
        title: '연결 해제 실패',
        message: e instanceof Error ? e.message : '알 수 없는 오류',
        color: 'red',
      });
    } finally {
      setDisconnecting(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!uid || !vertexData) return;
    const newEnabled = !(vertexData.enabled !== false);
    setTogglingEnabled(true);
    try {
      const userDocRef = doc(db, 'users', uid);
      await updateDoc(userDocRef, { 'vertexAI.enabled': newEnabled });
      setVertexData((prev) => prev ? { ...prev, enabled: newEnabled } : prev);
      notifications.show({
        title: newEnabled ? 'Vertex AI 활성화됨' : 'Vertex AI 비활성화됨',
        message: newEnabled
          ? 'Vertex AI OAuth가 다시 활성화되었습니다.'
          : '인증정보는 유지되며, Vertex AI 사용이 일시 중단되었습니다.',
        color: newEnabled ? 'green' : 'orange',
      });
    } catch (e) {
      console.error('Failed to toggle Vertex AI enabled:', e);
      notifications.show({
        title: '상태 변경 실패',
        message: e instanceof Error ? e.message : '알 수 없는 오류',
        color: 'red',
      });
    } finally {
      setTogglingEnabled(false);
    }
  };

  const fetchProjects = async () => {
    if (!uid) return;
    setLoadingProjects(true);
    try {
      const res = await fetch('/api/vertex-ai/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });

      const data = await res.json();
      if (!res.ok) {
        const detail = data?.details?.error?.message || data?.error || 'GCP 프로젝트 목록 조회 실패';
        throw new Error(detail);
      }

      setProjects(data.projects || []);
    } catch (e) {
      console.error('Failed to fetch GCP projects:', e);
      notifications.show({
        title: '프로젝트 조회 실패',
        message: 'GCP 프로젝트 목록을 불러오는 데 실패했습니다.',
        color: 'red',
      });
    } finally {
      setLoadingProjects(false);
    }
  };

  const handleVerify = async () => {
    if (!uid) return;
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch('/api/vertex-ai/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid }),
      });
      if (!res.ok) {
        throw new Error(`서버 오류: ${res.status}`);
      }
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
    } catch (e) {
      console.error('Verify request failed:', e);
      notifications.show({
        title: '무결성 검사 실패',
        message: '검사 요청 중 오류가 발생했습니다.',
        color: 'red',
      });
    } finally {
      setVerifying(false);
    }
  };

  if (loading) return null;

  const isConnected = Boolean(vertexData?.refreshToken);

  // Token expiry status — matches lib/vertex-ai-oauth.js onStatusChange shape
  const tokenExpiresAt = vertexData?.tokenExpiresAt ?? 0;
  const msLeft = tokenExpiresAt > 0 ? Math.max(0, tokenExpiresAt - Date.now()) : 0;
  const minutesLeft = Math.round(msLeft / 60_000);
  const tokenExpired = isConnected && tokenExpiresAt > 0 && msLeft === 0;

  return (
    <Paper withBorder shadow="sm" p="xl" radius="md" mb="xl">
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Text fw={600}>Vertex AI 연결</Text>
            <Text size="sm" c="dimmed">
              GCP 계정을 연결하여 본인의 Vertex AI 할당량으로 Gemini 모델을 사용합니다. API 키 없이 OAuth로 인증합니다.
            </Text>
          </div>
          {isConnected ? (
            <Badge color={tokenExpired ? 'orange' : vertexData?.enabled === false ? 'gray' : 'green'} variant="light" size="lg">
              {tokenExpired ? '토큰 만료' : vertexData?.enabled === false ? '비활성화' : '연결됨'}
            </Badge>
          ) : (
            <Badge color="gray" variant="light" size="lg">
              미연결
            </Badge>
          )}
        </Group>

        <Divider my="xs" />

        {isConnected ? (
          <>
            <Stack gap="xs">
              <Group gap="xs">
                <Text size="sm" fw={500}>프로젝트 ID:</Text>
                <Text size="sm" c="dimmed">{vertexData?.gcpProjectId || '(미설정)'}</Text>
              </Group>
              <Group gap="xs">
                <Text size="sm" fw={500}>리전:</Text>
                <Text size="sm" c="dimmed">{vertexData?.region || DEFAULT_REGION}</Text>
              </Group>
              {vertexData?.connectedAt && (
                <Group gap="xs">
                  <Text size="sm" fw={500}>연결일:</Text>
                  <Text size="sm" c="dimmed">{new Date(vertexData.connectedAt).toLocaleDateString('ko-KR')}</Text>
                </Group>
              )}
              {tokenExpiresAt > 0 && (
                <Group gap="xs">
                  <Text size="sm" fw={500}>토큰 상태:</Text>
                  <Text size="sm" c={tokenExpired ? 'orange' : 'dimmed'}>
                    {tokenExpired
                      ? '만료됨 (다음 API 호출 시 자동 갱신)'
                      : `${minutesLeft}분 후 갱신`}
                  </Text>
                </Group>
              )}
              <Group gap="xs" mt={4}>
                <Switch
                  checked={vertexData?.enabled !== false}
                  onChange={handleToggleEnabled}
                  disabled={togglingEnabled}
                  label={
                    <Text size="sm">
                      Vertex AI OAuth 사용{' '}
                      <Text span c="dimmed" size="xs">
                        (OFF 시 인증정보 유지, 공유 API 키로 폴백)
                      </Text>
                    </Text>
                  }
                />
              </Group>
            </Stack>

            <Group gap="xs" mt="xs">
              <Button
                variant="light"
                size="xs"
                onClick={fetchProjects}
                loading={loadingProjects}
              >
                프로젝트 목록 조회
              </Button>
              <Button
                variant="light"
                color="teal"
                size="xs"
                onClick={handleVerify}
                loading={verifying}
                leftSection={<IconShieldCheck size={14} />}
              >
                무결성 검사
              </Button>
              <Button
                color="red"
                variant="outline"
                size="xs"
                onClick={handleDisconnect}
                loading={disconnecting}
                leftSection={<IconCloudOff size={14} />}
              >
                연결 해제
              </Button>
            </Group>

            {verifyResult && (
              <Alert
                color={verifyResult.allOk ? 'teal' : 'red'}
                variant="light"
                icon={verifyResult.allOk ? <IconShieldCheck size={16} /> : <IconX size={16} />}
                mt="xs"
              >
                <Text size="sm" fw={600} mb={6}>
                  {verifyResult.allOk ? '✅ 무결성 검사 통과' : '❌ 무결성 검사 실패'}
                </Text>
                <List spacing={4} size="xs">
                  {verifyResult.steps.map((step) => (
                    <List.Item
                      key={step.name}
                      icon={
                        <ThemeIcon color={step.ok ? 'teal' : 'red'} size={16} radius="xl">
                          {step.ok ? <IconCheck size={10} /> : <IconX size={10} />}
                        </ThemeIcon>
                      }
                    >
                      <Text span fw={500}>{step.name}:</Text>{' '}
                      <Text span c="dimmed">{step.message}</Text>
                    </List.Item>
                  ))}
                </List>
              </Alert>
            )}

            {projects.length > 0 && (
              <Stack gap={4} mt="xs">
                <Text size="sm" fw={500}>사용 가능한 프로젝트:</Text>
                {projects.map((p) => (
                  <Text key={p.projectId} size="xs" c="dimmed">
                    {p.name} ({p.projectId})
                  </Text>
                ))}
              </Stack>
            )}
          </>
        ) : (
          <>
            <TextInput
              label="GCP Project ID"
              placeholder="my-gcp-project"
              value={projectId}
              onChange={(e) => setProjectId(e.currentTarget.value)}
            />

            <Select
              label="리전"
              data={REGION_OPTIONS}
              value={region}
              onChange={(v) => setRegion(v || DEFAULT_REGION)}
            />

            <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
              <Text size="sm">
                GCP 프로젝트에서 Vertex AI API가 활성화되어 있어야 합니다. 연결 후 본인 계정의 할당량과 요금이 적용됩니다.
              </Text>
            </Alert>

            <Button
              onClick={handleConnect}
              disabled={!projectId.trim()}
              leftSection={<IconCloud size={16} />}
            >
              GCP 계정 연결
            </Button>
          </>
        )}
      </Stack>
    </Paper>
  );
}
