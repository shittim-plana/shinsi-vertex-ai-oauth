'use client';

import React, { useState } from 'react';
import { Textarea, Button, Group } from '@mantine/core';
// import { useAuth } from '@/contexts/AuthContext'; // 로그인 상태 확인용

interface CommentFormProps {
  onSubmit: (content: string) => Promise<void>;
  initialContent?: string; // 수정 시 초기 내용
  placeholder?: string;
  buttonLabel?: string;
  onCancel?: () => void; // 수정 취소 핸들러 (선택적)
}

const CommentForm: React.FC<CommentFormProps> = ({
  onSubmit,
  initialContent = '', // 초기값 설정
  placeholder = '댓글을 입력하세요...',
  buttonLabel = '댓글 작성',
  onCancel, // 취소 핸들러 받기
}) => {
  const [content, setContent] = useState(initialContent); // 초기 내용으로 상태 설정
  const [loading, setLoading] = useState(false);
  // const { user } = useAuth(); // 로그인 상태 확인

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    // if (!user) {
    //   // 로그인 필요 알림 표시
    //   console.log('로그인이 필요합니다.');
    //   return;
    // }

    setLoading(true);
    try {
      await onSubmit(content);
      setContent(''); // 제출 후 내용 초기화
    } catch (error) {
      console.error('댓글 제출 오류:', error);
      // 오류 알림 표시
    } finally {
      setLoading(false);
    }
  };

  // TODO: 로그인 상태에 따라 폼 비활성화 또는 메시지 표시
  // if (!user) {
  //   return <Text>댓글을 작성하려면 로그인이 필요합니다.</Text>;
  // }

  return (
    <form onSubmit={handleSubmit}>
      <Textarea
        placeholder={placeholder}
        value={content}
        onChange={(event) => setContent(event.currentTarget.value)}
        required
        autosize
        minRows={2}
        // disabled={!user || loading} // 로그인 상태 및 로딩 상태에 따라 비활성화
        disabled={loading} // 임시로 로딩 상태만 확인
      />
      <Group justify="flex-end" mt="sm">
        {/* 취소 버튼 (onCancel prop이 있을 때만 표시) */}
        {onCancel && (
          <Button variant="default" onClick={onCancel} disabled={loading}>
            취소
          </Button>
        )}
        <Button type="submit" loading={loading}>
          {buttonLabel}
        </Button>
      </Group>
    </form>
  );
};

export default CommentForm;