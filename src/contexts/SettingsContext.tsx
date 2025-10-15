'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import Cookies from 'js-cookie'; // js-cookie import 추가
import { MantineColorScheme, useMantineColorScheme } from '@mantine/core';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuth } from './AuthContext'; // user 객체가 필요하면 유지

/**
 * Define settings interface
 * Add textColors to allow per-theme customization for normal, italic, bold text colors.
 */
interface Settings {
  theme: MantineColorScheme;
  notifications: boolean;
  memoryCapacity: number; // Number of messages to remember (0 or less means all)
  enableGoogleSearch: boolean; // Enable Google search functionality
  showPersonaSelector: boolean; // Show/hide persona selector in chat input
  showRefineButton: boolean; // Show/hide refine button in chat input
  promptMode: 'novel' | 'rp'; // Add prompt mode setting
  enableImageGeneration: boolean; // Enable NovelAI image generation
  hideImages: boolean; // Hide all images (generated and gallery)
  enableNSFW: boolean; // Allow NSFW content
  enableSummarization: boolean; // Enable/disable summarization
  sanitizeEllipsis: boolean; // Remove '…' and '...' from model responses

  // User-provided API key usage toggle
  useUserApiKeys?: boolean;

  membershipTier: 'none' | 'basic' | 'low_premium' | 'premium';
  aiModel?: string; // AI 모델 선택 (예: 'gemini-2.5-flash-preview-04-17')
  // Long-term memory toggle (RAG)
  longTermMemoryEnabled?: boolean;
  // Backward-compat alias
  enableLongTermMemory?: boolean;

  // Text color customization per theme and style
  textColors?: {
    light: {
      normal: string;
      italic: string;
      bold: string;
    };
    dark: {
      normal: string;
      italic: string;
      bold: string;
    };
  };
}

type MembershipTier = 'none' | 'basic' | 'low_premium' | 'premium';

// Define context type
type SettingsContextType = {
  settings: Settings;
  membershipTier: MembershipTier;
  loading: boolean;
  updateSettings: (newSettings: Partial<Settings>) => Promise<void>;
  refetchSettings: () => Promise<void>; // Add refetch function type
};

/**
 * Default settings
 * textColors default: per requirements, all styles are the same color for each theme
 * - light: black
 * - dark: white
 */
const defaultSettings: Settings = {
  theme: 'light',
  notifications: true,
  memoryCapacity: 5, // Default to 5 messages
  enableGoogleSearch: false, // Default to disabled for safety
  showPersonaSelector: true, // Default to showing the selector
  showRefineButton: true, // Default to showing the refine button
  promptMode: 'novel', // Default to novel mode
  enableImageGeneration: false, // Default to disabled
  hideImages: false, // Default to showing images
  enableNSFW: true,
  enableSummarization: false, // Default to enabled
  sanitizeEllipsis: false, // Default to removing ellipsis in responses
  useUserApiKeys: false, // Default to not using personal API keys
  membershipTier: 'none',
  aiModel: 'gemini-2.5-flash-preview-04-17', // 기본 AI 모델 설정
  longTermMemoryEnabled: false,
  enableLongTermMemory: false,
  textColors: {
    light: { normal: '#000000', italic: '#000000', bold: '#000000' },
    dark: { normal: '#ffffff', italic: '#ffffff', bold: '#ffffff' },
  },
};

// Create context with default values
const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  membershipTier: 'none',
  loading: true,
  updateSettings: async () => { },
  refetchSettings: async () => { }, // Add default refetch function
});

// Hook to use settings context
export const useSettings = () => useContext(SettingsContext);

// Provider component
export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [membershipTier, setMembershipTier] = useState<MembershipTier>('none');
  const [loading, setLoading] = useState(true);
  const { user, uid } = useAuth();
  const { setColorScheme } = useMantineColorScheme();

  // Function to fetch settings from Firestore
  const refetchSettings = async () => {
    const uidFromCookie = uid;

    if (!uidFromCookie) {
      setSettings(defaultSettings);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      const userDoc = await getDoc(userDocRef);

      if (userDoc.exists()) {
        const userData = userDoc.data();
        const userSettings = userData.settings || {};
        const validatedTheme = ['light', 'dark', 'auto'].includes(userSettings.theme)
          ? (userSettings.theme as MantineColorScheme)
          : defaultSettings.theme;
        const validatedPromptMode = ['novel', 'rp'].includes(userSettings.promptMode)
          ? (userSettings.promptMode as 'novel' | 'rp')
          : defaultSettings.promptMode;
        const tier = (userData.membershipTier as Settings['membershipTier']) || 'none';

        const finalSettings: Settings = {
          ...defaultSettings,
          ...userSettings,
          membershipTier: tier,
          theme: validatedTheme,
          promptMode: validatedPromptMode,
          aiModel: userSettings.aiModel || defaultSettings.aiModel,
        };

        setSettings(finalSettings);
        setMembershipTier(tier);
        setColorScheme(validatedTheme); // Set Mantine theme
      } else {
        // Firestore에 사용자 설정이 없는 경우, 기본 설정으로 초기화
        setSettings({ ...defaultSettings });
        setMembershipTier('none');
        setColorScheme(defaultSettings.theme); // Set default Mantine theme
      }
    } catch (error) {
      console.error('Error fetching user settings:', error);
      setSettings({ ...defaultSettings }); // showRefineButton: true 제거하고 전체 기본값 사용
      setColorScheme(defaultSettings.theme); // Set default Mantine theme on error
    } finally {
      setLoading(false);
    }
  };

  // Fetch user settings on mount or when user changes
  useEffect(() => {
    refetchSettings();
  }, [user]);

  // Update settings
  const updateSettings = async (newSettings: Partial<Settings>) => {
    console.log('Updating settings:', newSettings);
    const uidFromCookie = uid;
    if (!uidFromCookie) return;

    try {
      const updatedSettings = { ...settings, ...newSettings } as Settings;
      const { membershipTier, ...settingsWithoutTier } = updatedSettings;
      const maxMemory = Infinity

      setSettings(updatedSettings);
      setMembershipTier(membershipTier);

      // Update Firestore
      const userDocRef = doc(db, 'users', uidFromCookie); // 쿠키 uid 사용
      await updateDoc(userDocRef, {
        settings: settingsWithoutTier,
        membershipTier,
      });
      setColorScheme(updatedSettings.theme);
    } catch (error) {
      console.error('Error updating settings:', error);
      throw error;
    }
  };

  const value = {
    settings,
    membershipTier,
    loading,
    updateSettings,
    refetchSettings, // Expose refetch function
  };

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};

export default SettingsContext;