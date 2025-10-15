'use client';

import { useState } from 'react';
import { Container, Title, Text, TextInput, Switch, Group, Button, Paper, Stack, Alert } from '@mantine/core';
import { IconAlertCircle, IconShieldCheck } from '@tabler/icons-react';
import { useAuth } from '@/contexts/AuthContext';
import { db } from '@/firebase/config';
import { doc, getDoc } from 'firebase/firestore';
import { notifications } from '@mantine/notifications';
import { AppShell } from '@/components/layout/AppShell';

type RoleState = {
  isAdmin: boolean;
  isSubadmin: boolean;
};

export default function AdminUsersPage() {
  const { user, loading } = useAuth();
  const [targetUid, setTargetUid] = useState('');
  const [roles, setRoles] = useState<RoleState | null>(null);
  const [loadingUser, setLoadingUser] = useState(false);
  const [saving, setSaving] = useState(false);

  const isPrivileged = !!(user?.isAdmin); // 관리자만 권한 변경 가능

  const loadUser = async () => {
    if (!targetUid.trim()) {
      notifications.show({ color: 'red', title: '입력 필요', message: '대상 사용자 UID를 입력하세요.' });
      return;
    }
    setLoadingUser(true);
    try {
      const userRef = doc(db, 'users', targetUid.trim());
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        setRoles(null);
        notifications.show({ color: 'red', title: '미발견', message: '해당 UID의 사용자 문서를 찾을 수 없습니다.' });
        return;
      }
      const data = snap.data() as any;
      setRoles({
        isAdmin: !!data.isAdmin,
        isSubadmin: !!data.isSubadmin,
      });
      notifications.show({ color: 'green', title: '로딩 완료', message: '사용자 권한 정보를 불러왔습니다.' });
    } catch (e) {
      console.error('Failed to load user roles', e);
      notifications.show({ color: 'red', title: '오류', message: '사용자 정보를 불러오는 중 오류가 발생했습니다.' });
    } finally {
      setLoadingUser(false);
    }
  };

  const saveRoles = async () => {
    if (!isPrivileged) return;
    if (!roles) {
      notifications.show({ color: 'red', title: '오류', message: '먼저 사용자 정보를 불러오세요.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUid: targetUid.trim(),
          isAdmin: roles.isAdmin,
          isSubadmin: roles.isSubadmin,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || '권한 저장 실패');
      }
      notifications.show({ color: 'green', title: '저장 완료', message: '사용자 권한이 업데이트되었습니다.' });
    } catch (e: any) {
      notifications.show({ color: 'red', title: '저장 실패', message: e?.message || '권한 저장 중 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <Container size="sm" py="xl">
          <Text>로딩 중...</Text>
        </Container>
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <Container size="sm" py="xl">
          <Alert icon={<IconAlertCircle size={16} />} title="로그인 필요" color="blue">
            관리자 페이지에 접근하려면 로그인하세요.
          </Alert>
        </Container>
      </AppShell>
    );
  }

  if (!isPrivileged) {
    return (
      <AppShell>
        <Container size="sm" py="xl">
          <Alert icon={<IconAlertCircle size={16} />} title="접근 권한 없음" color="red">
            이 페이지는 관리자만 접근할 수 있습니다.
          </Alert>
        </Container>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Container size="sm" py="xl">
        <Group justify="space-between" mb="lg">
          <Title order={2}>관리자: 사용자 권한 관리</Title>
          <IconShieldCheck size={28} />
        </Group>

        <Paper withBorder p="lg" radius="md">
          <Stack gap="md">
            <TextInput
              label="대상 사용자 UID"
              placeholder="예: 8hA1b2C3D4..."
              value={targetUid}
              onChange={(e) => setTargetUid(e.currentTarget.value)}
              disabled={loadingUser || saving}
            />
            <Group>
              <Button onClick={loadUser} loading={loadingUser} variant="default">
                사용자 불러오기
              </Button>
            </Group>

            {roles && (
              <>
                <Switch
                  label="관리자 (isAdmin)"
                  checked={roles.isAdmin}
                  onChange={(e) => setRoles((r) => r ? { ...r, isAdmin: e.currentTarget.checked } : r)}
                  disabled={saving}
                />
                <Switch
                  label="부관리자 (isSubadmin)"
                  checked={roles.isSubadmin}
                  onChange={(e) => setRoles((r) => r ? { ...r, isSubadmin: e.currentTarget.checked } : r)}
                  disabled={saving}
                />
                <Group justify="flex-end" mt="md">
                  <Button onClick={saveRoles} loading={saving}>
                    권한 저장
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Paper>

        <Paper withBorder p="lg" radius="md" mt="lg">
          <Title order={4} mb="xs">권한 정책</Title>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>관리자: 모든 캐릭터/로어 열람, 모든 사용자 세션 URL 접근, 권한(관리자/부관리자) 지정 가능</li>
            <li>부관리자: creatorId와 무관하게 캐릭터/로어 삭제 또는 숨김(비공개 전환) 가능</li>
          </ul>
        </Paper>
      </Container>
    </AppShell>
  );
}