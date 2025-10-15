'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Center, Loader, Text } from '@mantine/core';

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/home');
      } else {
        router.push('/login');
      }
    }
  }, [user, loading, router]);

  return (
    <Center style={{ height: '100vh' }}>
      <div style={{ textAlign: 'center' }}>
        <Loader size="xl" mb="lg" />
        <Text size="lg" fw={500}>
          Loading...
        </Text>
      </div>
    </Center>
  );
}
