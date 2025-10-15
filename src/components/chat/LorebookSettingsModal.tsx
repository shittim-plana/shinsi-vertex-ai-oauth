'use client';

import { useState, useEffect, useMemo } from 'react'; // useMemo 추가
import { Modal, MultiSelect, Button, Group, Stack, Loader, Text, Alert, SegmentedControl } from '@mantine/core'; // Alert 추가
import { notifications } from '@mantine/notifications';
import { IconBook, IconCheck, IconX, IconAlertCircle } from '@tabler/icons-react'; // IconAlertCircle 추가
// db, collection, query, where, getDocs, orderBy 제거
import { useAuth } from '@/contexts/AuthContext';
import { useAccessibleLorebooks } from '@/hooks/useAccessibleLorebooks'; // Hook 임포트
import { ChatRoom } from '@/types/chat'; // ChatRoom 타입 임포트
import { LorebookEntry } from '@/types/lorebook'; // LorebookEntry 타입 임포트

// MultiSelect 데이터 형식 정의
interface LorebookSelectItem {
  value: string; // Lorebook ID
  label: string; // Lorebook Title
}

interface LorebookSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  chatRoom: ChatRoom | null;
  initialOrderMode?: 'room_first' | 'character_first';
  onSave: (selectedLorebookIds: string[], options?: { orderMode?: 'room_first' | 'character_first' }) => Promise<void>; // 저장 함수 prop
}

export function LorebookSettingsModal({ isOpen, onClose, chatRoom, onSave, initialOrderMode }: LorebookSettingsModalProps) {
  const { uid } = useAuth();
  // useAccessibleLorebooks hook 사용
  const { lorebookEntries, loading: loadingLorebooks, error: lorebookError } = useAccessibleLorebooks(uid);
  const [selectedLorebooks, setSelectedLorebooks] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [orderMode, setOrderMode] = useState<'room_first' | 'character_first'>(initialOrderMode || 'room_first');

  // 로어북 데이터를 MultiSelect 형식으로 변환 (useMemo 사용)
  const lorebookOptions = useMemo(() => {
    return lorebookEntries.map((entry: LorebookEntry) => ({
      value: entry.id,
      label: entry.title,
    }));
  }, [lorebookEntries]);

  // 기존 useEffect 로직 제거 (hook이 데이터 로딩 처리)

  // Initialize selected lorebooks when chatRoom data is available or modal opens
  useEffect(() => {
    if (isOpen) { // 모달이 열릴 때만 초기화
      if (chatRoom?.lorebookIds) {
        setSelectedLorebooks(chatRoom.lorebookIds);
      } else {
        setSelectedLorebooks([]); // Reset if no lorebooks are associated
      }
      // 우선순위 초기화: props > chatRoom 필드 > 기본값
      const modeFromRoom = (chatRoom as any)?.lorebookOrderMode as ('room_first' | 'character_first') | undefined;
      setOrderMode(initialOrderMode || modeFromRoom || 'room_first');
    }
  }, [chatRoom, isOpen, initialOrderMode]); // Update when chatRoom changes or modal opens

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(selectedLorebooks, { orderMode });
      notifications.show({
        title: '저장 완료',
        message: '채팅방 로어북 설정이 저장되었습니다.',
        color: 'green',
        icon: <IconCheck />,
      });
      onClose(); // Close modal on successful save
    } catch (error) {
      console.error("Error saving lorebook settings:", error);
      notifications.show({
        title: '저장 실패',
        message: '로어북 설정을 저장하는 중 오류가 발생했습니다.',
        color: 'red',
        icon: <IconX />,
      });
      // Keep modal open on error
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      opened={isOpen}
      onClose={onClose}
      title="채팅방 로어북 설정"
      centered
      size="md"
    >
      <Stack>
        <Text size="sm">채팅 시 AI가 참고할 로어북을 선택하세요. (자신의 로어북 + 공개 로어북)</Text>
        <Group justify="space-between" align="center">
          <Text size="sm" c="dimmed">적용 우선순위</Text>
          <SegmentedControl
            value={orderMode}
            onChange={(val) => setOrderMode(val as 'room_first' | 'character_first')}
            data={[
              { label: '채팅방 우선', value: 'room_first' },
              { label: '캐릭터 우선', value: 'character_first' },
            ]}
          />
        </Group>
        {loadingLorebooks ? (
          <Group justify="center" my="md">
            <Loader size="sm" />
            <Text size="sm">로어북 목록 로딩 중...</Text>
          </Group>
        ) : lorebookError ? ( // 에러 상태 표시
          <Alert icon={<IconAlertCircle size="1rem" />} title="로딩 오류" color="red" my="md">
            {lorebookError}
          </Alert>
        ) : lorebookOptions.length === 0 ? (
           <Text size="sm" c="dimmed" ta="center" my="md">사용 가능한 로어북이 없습니다. 먼저 로어북 메뉴에서 생성해주세요.</Text>
        ) : (
          <MultiSelect
            data={lorebookOptions} // 변환된 데이터 사용
            value={selectedLorebooks}
            onChange={setSelectedLorebooks}
            placeholder="연결할 로어북 선택"
            searchable
            clearable
            leftSection={<IconBook size={14} />}
          />
        )}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={onClose} disabled={isSaving}>
            취소
          </Button>
          {/* 에러 발생 시 저장 버튼 비활성화 */}
          <Button onClick={handleSave} loading={isSaving} disabled={loadingLorebooks || !!lorebookError || lorebookOptions.length === 0}>
            저장하기
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}