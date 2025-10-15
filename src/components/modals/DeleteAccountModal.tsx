'use client';

import { useState } from 'react';
import { Modal, Stack, Text, Checkbox, TextInput, Button, Group, Alert, Loader } from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { getAuth } from 'firebase/auth';
import { useRouter } from 'next/navigation';
import { notifications } from '@mantine/notifications';

interface DeleteAccountModalProps {
  opened: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteAccountModal({ opened, onClose, onDeleted }: DeleteAccountModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const router = useRouter();

  const handleDelete = async () => {
    if (!agreed || confirmText !== 'DELETE') {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const auth = getAuth();
      const user = auth.currentUser;

      if (!user) {
        throw new Error('로그인이 필요합니다.');
      }

      const token = await user.getIdToken();

      const response = await fetch('/api/user/delete', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details?.errors?.[0] || '회원탈퇴 처리 중 오류가 발생했습니다.');
      }

      // 성공 시 로그아웃 및 리디렉션
      await auth.signOut();
      onDeleted();
      router.replace('/login');

      notifications.show({
        title: '회원탈퇴 완료',
        message: '회원탈퇴가 성공적으로 처리되었습니다.',
        color: 'green',
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.';
      setError(errorMessage);
      notifications.show({
        title: '회원탈퇴 실패',
        message: errorMessage,
        color: 'red',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const canDelete = agreed && confirmText === 'DELETE' && !isLoading;

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="회원탈퇴 확인"
      centered
      size="md"
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
      closeOnClickOutside={!isLoading}
      closeOnEscape={!isLoading}
    >
      <Stack gap="md">
        <Alert variant="light" color="red" title="경고" icon={<IconAlertTriangle size={16} />}>
          <Text size="sm">
            탈퇴 시 모든 데이터가 영구 삭제되며 복구할 수 없습니다.
            이 작업은 즉시 실행되며 취소할 수 없습니다.
          </Text>
        </Alert>

        <Checkbox
          label="영구 삭제에 동의합니다"
          checked={agreed}
          onChange={(event) => setAgreed(event.currentTarget.checked)}
          disabled={isLoading}
        />

        <TextInput
          label="확인을 위해 'DELETE'를 입력하세요"
          placeholder="DELETE"
          value={confirmText}
          onChange={(event) => setConfirmText(event.currentTarget.value)}
          disabled={isLoading}
          required
        />

        {error && (
          <Alert variant="light" color="red" title="오류" icon={<IconAlertTriangle size={16} />}>
            <Text size="sm">{error}</Text>
          </Alert>
        )}

        <Group justify="flex-end" mt="lg">
          <Button variant="outline" onClick={onClose} disabled={isLoading}>
            취소
          </Button>
          <Button
            color="red"
            onClick={handleDelete}
            disabled={!canDelete}
            leftSection={isLoading ? <Loader size={16} /> : <IconTrash size={16} />}
            loading={isLoading}
          >
            {isLoading ? '처리 중...' : '영구 삭제'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}