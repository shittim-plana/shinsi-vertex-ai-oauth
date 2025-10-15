'use client';

import { Modal, TextInput, Textarea, Button, Group, Stack, Text } from '@mantine/core';
import { useForm } from '@mantine/form';
import { IconGitBranch } from '@tabler/icons-react';
import { useState } from 'react';

interface ForkModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: (description?: string) => Promise<void>;
  messagePreview?: string;
  isLoading?: boolean;
}

interface ForkFormValues {
  description: string;
}

export default function ForkModal({ 
  opened, 
  onClose, 
  onConfirm, 
  messagePreview,
  isLoading = false 
}: ForkModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ForkFormValues>({
    initialValues: {
      description: ''
    },
    validate: {
      description: (value) => {
        if (value.trim().length > 200) {
          return '분기 사유는 200자 이하로 입력해주세요.';
        }
        return null;
      }
    }
  });

  const handleSubmit = async (values: ForkFormValues) => {
    // 🔍 DEBUG LOG: ForkModal handleSubmit 진입점 체크
    console.log('[DEBUG] ForkModal handleSubmit called:', {
      values,
      valuesType: typeof values,
      description: values?.description,
      descriptionLength: values?.description?.length || 0,
      isSubmitting,
      isLoading,
      onConfirm: !!onConfirm,
      onConfirmType: typeof onConfirm
    });

    if (isSubmitting || isLoading) return;
    
    setIsSubmitting(true);
    try {
      const description = values.description.trim();
      
      // 🔍 DEBUG LOG: onConfirm 호출 직전 상태
      console.log('[DEBUG] ForkModal: onConfirm 호출 예정', {
        description,
        descriptionType: typeof description,
        descriptionLength: description.length,
        paramToPass: description || undefined
      });
      
      await onConfirm(description || undefined);
      form.reset();
      onClose();
    } catch (error) {
      console.error('분기 생성 중 오류:', error);
      // 에러 처리는 부모 컴포넌트에서 담당
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (isSubmitting || isLoading) return;
    form.reset();
    onClose();
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group gap="xs">
          <IconGitBranch size={20} />
          <Text fw={600}>채팅방 분기 생성</Text>
        </Group>
      }
      size="md"
      centered
      closeOnClickOutside={!isSubmitting && !isLoading}
      closeOnEscape={!isSubmitting && !isLoading}
    >
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            이 지점에서 새로운 분기를 생성합니다. 현재 메시지까지의 대화 내용이 새 채팅방으로 복사됩니다.
          </Text>

          {messagePreview && (
            <Group style={{ 
              padding: '12px', 
              borderRadius: '8px',
            }}>
              <Text size="xs" c="dimmed" mb="xs">분기 기준 메시지:</Text>
              <Text 
                size="sm" 
                lineClamp={3}
                style={{ 
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap'
                }}
              >
                {messagePreview}
              </Text>
            </Group>
          )}

          <Textarea
            label="분기 사유 (선택사항)"
            placeholder="이 분기를 생성하는 이유를 간단히 설명해주세요..."
            description="나중에 분기들을 구분하는 데 도움이 됩니다."
            minRows={3}
            maxRows={5}
            maxLength={200}
            {...form.getInputProps('description')}
            disabled={isSubmitting || isLoading}
          />

          <Group justify="flex-end" gap="sm">
            <Button 
              variant="subtle" 
              onClick={handleClose}
              disabled={isSubmitting || isLoading}
            >
              취소
            </Button>
            <Button 
              type="submit"
              loading={isSubmitting || isLoading}
              leftSection={<IconGitBranch size={16} />}
            >
              분기 생성
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}