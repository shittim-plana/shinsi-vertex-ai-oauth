'use client';

import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Textarea, TextareaProps } from '@mantine/core';

interface AutoResizeTextareaProps extends Omit<TextareaProps, 'autosize' | 'minRows' | 'maxRows'> {
  maxRows?: number;
  minRows?: number;
  onHeightChange?: (height: number) => void;
}

export interface AutoResizeTextareaRef {
  focus: () => void;
  blur: () => void;
  getElement: () => HTMLTextAreaElement | null;
}

const AutoResizeTextarea = forwardRef<AutoResizeTextareaRef, AutoResizeTextareaProps>(
  ({ maxRows = 5, minRows = 1, onHeightChange, ...props }, ref) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => textareaRef.current?.focus(),
      blur: () => textareaRef.current?.blur(),
      getElement: () => textareaRef.current,
    }));

    const adjustHeight = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // 높이를 초기화하여 정확한 scrollHeight 측정
      textarea.style.height = 'auto';
      
      // 줄 높이 계산
      const computedStyle = window.getComputedStyle(textarea);
      const lineHeight = parseInt(computedStyle.lineHeight) || 20;
      const paddingTop = parseInt(computedStyle.paddingTop) || 0;
      const paddingBottom = parseInt(computedStyle.paddingBottom) || 0;
      
      // 최소/최대 높이 계산
      const minHeight = lineHeight * minRows + paddingTop + paddingBottom;
      const maxHeight = lineHeight * maxRows + paddingTop + paddingBottom;
      
      // 실제 콘텐츠 높이
      const scrollHeight = textarea.scrollHeight;
      
      // 높이 제한 적용
      const newHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight);
      
      textarea.style.height = `${newHeight}px`;
      
      // 높이 변화 콜백 호출
      if (onHeightChange) {
        onHeightChange(newHeight);
      }
    };

    useEffect(() => {
      adjustHeight();
    }, [props.value, maxRows, minRows]);

    useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      // 초기 높이 설정
      adjustHeight();

      // input 이벤트 리스너 추가
      const handleInput = () => {
        adjustHeight();
      };

      textarea.addEventListener('input', handleInput);
      
      // 창 크기 변경 시에도 높이 재조정
      const handleResize = () => {
        requestAnimationFrame(adjustHeight);
      };
      
      window.addEventListener('resize', handleResize);

      return () => {
        textarea.removeEventListener('input', handleInput);
        window.removeEventListener('resize', handleResize);
      };
    }, []);

    return (
      <Textarea
        {...props}
        ref={textareaRef}
        autosize={false} // 우리가 직접 관리
        styles={{
          input: {
            resize: 'none', // 사용자가 수동으로 크기 조절하지 못하도록
            transition: 'height 0.1s ease', // 부드러운 높이 전환
            ...(typeof props.styles === 'object' && props.styles?.input ? props.styles.input : {}),
          },
        }}
      />
    );
  }
);

AutoResizeTextarea.displayName = 'AutoResizeTextarea';

export default AutoResizeTextarea;