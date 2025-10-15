'use client';

import { useEffect } from 'react';
import { analytics } from '@/firebase/firebase'; // Import analytics instance

export function FirebaseAnalytics() {
  useEffect(() => {
    // This effect ensures analytics is initialized when the component mounts
    // The actual initialization happens in firebase.ts based on browser support
    if (analytics) {
      // You can log an event here if needed, e.g., page_view
      // logEvent(analytics, 'page_view', { page_path: window.location.pathname });
      console.log("Firebase Analytics initialized");
    }
  }, []); // Empty dependency array ensures this runs only once on mount

  return null; // This component doesn't render anything visible
}