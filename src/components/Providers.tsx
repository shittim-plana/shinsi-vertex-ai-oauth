'use client';

import { ReactNode } from 'react'; // Import useEffect
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { AuthProvider } from '@/contexts/AuthContext';
import { SettingsProvider, useSettings } from '@/contexts/SettingsContext';
import { theme } from '@/theme/mantine-theme';

// Mantine core CSS
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/dates/styles.css';

interface ProvidersProps {
  children: ReactNode;
}

// Removed ThemeSync component

// Wrapper component to access settings and provide Mantine context
function MantineWrapper({ children }: ProvidersProps) {
  const { settings } = useSettings(); // Access settings context

  // Determine the color scheme based on settings
  const colorScheme = settings.theme === 'dark' ? 'dark' : 'light';

  return (
    <MantineProvider
      theme={theme}
      defaultColorScheme={colorScheme}
      // Mantine v7 기준: withCssVariables/withGlobalStyles prop은 존재하지 않습니다.
      // 전역 스타일과 변수는 core/styles.css 임포트와 theme로 처리됩니다.
    >
      <Notifications position="top-right" zIndex={4000} />
      {children}
    </MantineProvider>
  );
}


export function Providers({ children }: ProvidersProps) {
  return (
    <>
      <AuthProvider>
          {/* Wrap children with MantineWrapper which accesses settings */}
          <MantineWrapper>
            <SettingsProvider>
            {children}
            </SettingsProvider>
          </MantineWrapper>
      </AuthProvider>
    </>
  );
}

export default Providers;