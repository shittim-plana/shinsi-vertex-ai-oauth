'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Container, Paper, Title, Box, Text, Group, Anchor } from '@mantine/core';
import { useAuth } from '@/contexts/AuthContext';
import Link from 'next/link';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Redirect authenticated users to home
  useEffect(() => {
    if (!loading && user) {
      router.push('/home');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <Container size="xs" px="xs" py="xl">
        <Text ta="center">로딩 중...</Text>
      </Container>
    );
  }

  return (
    <Container size="xs" px="xs" py="xl">
      <Box mb={30} ta="center">
        <Title order={1} fw={700} size="2.5rem" c="lightBlue">
          신시
        </Title>
        <Text c="dimmed" size="sm">
          AI 채팅 플랫폼
        </Text>
      </Box>

      <Paper radius="md" p="xl" withBorder shadow="md">
        {children}
      </Paper>

      <Group mt="md" justify="center">
        <Text size="sm" c="dimmed">
          {pathname.includes('login') ? '계정이 없으신가요?' : '이미 계정이 있으신가요?'}
        </Text>
        <Anchor component={Link} href={pathname.includes('login') ? '/signup' : '/login'} size="sm">
          {pathname.includes('login') ? '회원가입' : '로그인'}
        </Anchor>
      </Group>
    </Container>
  );
}