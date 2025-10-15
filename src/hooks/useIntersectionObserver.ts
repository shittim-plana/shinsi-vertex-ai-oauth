import { useRef, useEffect, RefObject } from 'react';

interface UseIntersectionObserverProps {
  /** The callback function to execute when the target element intersects. */
  onIntersect: () => void;
  /** Ref object pointing to the target DOM element. */
  targetRef: RefObject<Element | null>; // Allow null for the ref's current value
  /** Condition to enable or disable the observer callback execution (e.g., !loading && hasMore). */
  enabled?: boolean;
  /** Intersection Observer options (threshold, root, rootMargin). */
  options?: IntersectionObserverInit;
}

/**
 * Custom hook to simplify the use of Intersection Observer API.
 *
 * @param onIntersect - Callback function executed when the target intersects.
 * @param targetRef - Ref object for the target element to observe.
 * @param enabled - Boolean flag to conditionally trigger the onIntersect callback. Defaults to true.
 * @param options - Optional Intersection Observer options.
 */
export function useIntersectionObserver({
  onIntersect,
  targetRef,
  enabled = true, // Default to enabled
  options = { threshold: 0.1 }, // Default options
}: UseIntersectionObserverProps): void {
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const currentTarget = targetRef.current;

    // Clean up previous observer if target changes or component unmounts
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (!currentTarget) {
      // console.log('[useIntersectionObserver] Target is null.'); // Debug log removed
      return; // No target to observe
    }

    // Create and connect the observer only if we have a target
    // console.log('[useIntersectionObserver] Creating and observing target:', currentTarget); // Debug log removed
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        // console.log('[useIntersectionObserver Callback] Entry:', entry.isIntersecting, 'Enabled:', enabled); // Debug log removed
        if (entry.isIntersecting && enabled) {
          // console.log('[useIntersectionObserver Callback] Triggering onIntersect.'); // Debug log removed
          onIntersect();
        }
      },
      options
    );

    observerRef.current.observe(currentTarget);

    // Cleanup function for when the component unmounts or dependencies change
    return () => {
      // console.log('[useIntersectionObserver Cleanup] Disconnecting observer.'); // Debug log removed
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
    // Dependencies: Re-run effect if the callback, target, enabled state, or options change.
    // Note: options object should ideally be memoized if passed dynamically.
  }, [onIntersect, targetRef, enabled, options]);
}