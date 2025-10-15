import { useEffect, useState } from 'react';

interface KeyboardState {
  isKeyboardOpen: boolean;
  keyboardHeight: number;
  viewportHeight: number;
  availableHeight: number;
}

interface UseKeyboardHandlerOptions {
  threshold?: number; // 키보드 감지 임계값 (기본값: 150px)
  debounceMs?: number; // 디바운스 시간 (기본값: 100ms)
}

/**
 * 모바일 키보드 표시/숨김을 감지하는 훅
 * Visual Viewport API를 사용하여 키보드 상태를 추적합니다.
 * 
 * @param options 설정 옵션
 * @returns 키보드 상태 정보
 */
export function useKeyboardHandler(options: UseKeyboardHandlerOptions = {}): KeyboardState {
  const { threshold = 150, debounceMs = 100 } = options;

  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isKeyboardOpen: false,
    keyboardHeight: 0,
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
    availableHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  });

  useEffect(() => {
    // 모바일 환경이 아니면 키보드 감지 비활성화
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (!isMobile) {
      return;
    }

    let debounceTimer: NodeJS.Timeout;
    let initialViewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;

    // Visual Viewport API를 지원하는 경우
    if (window.visualViewport) {
      const handleViewportChange = () => {
        clearTimeout(debounceTimer);
        
        debounceTimer = setTimeout(() => {
          const currentHeight = window.visualViewport?.height || window.innerHeight;
          const heightDifference = initialViewportHeight - currentHeight;
          
          const isKeyboardOpen = heightDifference > threshold;
          const keyboardHeight = isKeyboardOpen ? heightDifference : 0;

          setKeyboardState({
            isKeyboardOpen,
            keyboardHeight,
            viewportHeight: currentHeight,
            availableHeight: currentHeight,
          });
        }, debounceMs);
      };

      // 초기 높이 설정
      initialViewportHeight = window.visualViewport.height;

      // 이벤트 리스너 등록
      window.visualViewport.addEventListener('resize', handleViewportChange);
      window.visualViewport.addEventListener('scroll', handleViewportChange);

      return () => {
        clearTimeout(debounceTimer);
        window.visualViewport?.removeEventListener('resize', handleViewportChange);
        window.visualViewport?.removeEventListener('scroll', handleViewportChange);
      };
    }

    // Visual Viewport API를 지원하지 않는 경우 fallback
    const handleWindowResize = () => {
      clearTimeout(debounceTimer);
      
      debounceTimer = setTimeout(() => {
        const currentHeight = window.innerHeight;
        const heightDifference = initialViewportHeight - currentHeight;
        
        const isKeyboardOpen = heightDifference > threshold;
        const keyboardHeight = isKeyboardOpen ? heightDifference : 0;

        setKeyboardState({
          isKeyboardOpen,
          keyboardHeight,
          viewportHeight: currentHeight,
          availableHeight: currentHeight,
        });
      }, debounceMs);
    };

    // 페이지 로드 시 초기 높이 저장
    const handleLoad = () => {
      if (typeof window !== 'undefined') {
        initialViewportHeight = window.innerHeight;
      }
    };

    // iOS Safari의 경우 orientationchange 이벤트도 처리
    const handleOrientationChange = () => {
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          initialViewportHeight = window.innerHeight;
          handleWindowResize();
        }
      }, 100); // iOS에서 orientation change 후 약간의 지연이 필요
    };

    window.addEventListener('load', handleLoad);
    window.addEventListener('resize', handleWindowResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    // 페이지가 이미 로드된 경우
    if (document.readyState === 'complete') {
      handleLoad();
    }

    return () => {
      clearTimeout(debounceTimer);
      window.removeEventListener('load', handleLoad);
      window.removeEventListener('resize', handleWindowResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [threshold, debounceMs]);

  return keyboardState;
}

/**
 * 특정 요소가 키보드에 가려지는지 확인하는 유틸리티 함수
 * 
 * @param element 확인할 DOM 요소
 * @param keyboardHeight 키보드 높이
 * @returns 키보드에 가려지는지 여부
 */
export function isElementHiddenByKeyboard(
  element: HTMLElement | null,
  keyboardHeight: number
): boolean {
  if (!element || keyboardHeight === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  
  // 요소의 하단이 키보드 영역에 있는지 확인
  return rect.bottom > viewportHeight;
}

/**
 * 키보드가 표시될 때 특정 요소를 뷰포트에 맞게 스크롤하는 함수
 * 
 * @param element 스크롤할 DOM 요소
 * @param behavior 스크롤 동작 ('smooth' | 'auto')
 * @param offset 추가 오프셋 (기본값: 20px)
 */
export function scrollElementIntoKeyboardView(
  element: HTMLElement | null,
  behavior: ScrollBehavior = 'smooth',
  offset: number = 20
): void {
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  
  // 요소가 키보드에 가려지는 경우에만 스크롤
  if (rect.bottom > viewportHeight - offset) {
    const scrollTop = window.pageYOffset + rect.bottom - viewportHeight + offset;
    
    window.scrollTo({
      top: scrollTop,
      behavior,
    });
  }
}