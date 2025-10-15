'use client';

import { Modal, TextInput, Textarea, Button, Group, Stack, TagsInput, Switch } from '@mantine/core'; // TagsInput, Switch 추가
import { useForm } from '@mantine/form';
import { useEffect } from 'react';
import { LorebookEntry } from '@/types/lorebook';

interface LorebookModalProps {
  opened: boolean;
  onClose: () => void;
  // onSubmit 콜백의 타입 시그니처 업데이트
  onSubmit: (values: { title: string; description: string; tags: string[]; isPublic: boolean }) => void;
  initialData?: LorebookEntry | null; // 수정 시 초기 데이터
  isLoading: boolean; // 제출 로딩 상태
}

export function LorebookModal({ opened, onClose, onSubmit, initialData, isLoading }: LorebookModalProps) {
  const form = useForm({
    initialValues: {
      title: '',
      description: '',
      tags: [] as string[], // tags 필드 추가 및 초기화
      isPublic: false, // isPublic 필드 추가 및 기본값 false (비공개)
    },
    validate: {
      title: (value) => (value.trim().length > 0 ? null : '제목을 입력해주세요.'),
      description: (value) => (value.trim().length > 0 ? null : '설명을 입력해주세요.'),
      // tags는 필수가 아님
    },
  });

  // 수정 모드일 때 초기 데이터 설정
  useEffect(() => {
    if (initialData) {
      form.setValues({
        title: initialData.title,
        description: initialData.description,
        tags: initialData.tags || [], // tags가 없으면 빈 배열
        isPublic: initialData.isPublic || false, // isPublic이 없으면 false
      });
    } else {
      form.reset(); // 추가 모드일 때 폼 초기화 (tags, isPublic 포함)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, opened]);

  // handleSubmit 타입 업데이트
  const handleSubmit = (values: { title: string; description: string; tags: string[]; isPublic: boolean }) => {
    onSubmit(values);
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={initialData ? '로어북 수정' : '새 로어북 추가'}
      centered
      size="lg"
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput
            label="제목"
            placeholder="로어북 항목의 제목"
            required
            {...form.getInputProps('title')}
          />
          <Textarea
            label="설명"
            placeholder="로어북 항목에 대한 상세 설명"
            required
            autosize
            minRows={5}
            maxRows={15}
            {...form.getInputProps('description')}
          />
          <TagsInput
            label="태그"
            placeholder="태그 입력 후 Enter (예: 세계관, 인물)"
            description="관련 태그를 추가하여 로어북을 분류할 수 있습니다."
            clearable // 입력 내용 지우기 버튼 표시
            {...form.getInputProps('tags')}
          />
          <Switch
            label="공개 설정"
            description="체크하면 다른 사용자도 이 로어북 항목을 볼 수 있습니다."
            {...form.getInputProps('isPublic', { type: 'checkbox' })}
          />
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose} disabled={isLoading}>
              취소
            </Button>
            <Button type="submit" loading={isLoading} disabled={isLoading}>
              {initialData ? '수정하기' : '추가하기'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}