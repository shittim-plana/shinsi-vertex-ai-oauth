'use client';

import { useState } from 'react';
import { TextInput, PasswordInput, Button, Divider, Group, Text, Anchor } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { IconBrandGoogle, IconUserOff } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

export default function LoginPage() {
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [anonymousLoading, setAnonymousLoading] = useState(false);
  const { logIn, googleSignIn, anonymousLogin } = useAuth();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      email: '',
      password: '',
    },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '유효한 이메일을 입력해주세요'),
      password: (value) => (value.length >= 6 ? null : '비밀번호는 최소 6자 이상이어야 합니다'),
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    setEmailLoading(true);
    try {
      await logIn(values.email, values.password);
      router.push('/home');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      notifications.show({
        title: '로그인 실패',
        message: '이메일이나 비밀번호를 확인해주세요.',
        color: 'red',
      });
      console.error('로그인 오류:', errorMessage);
    } finally {
      setEmailLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      await googleSignIn();
      router.push('/home');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      notifications.show({
        title: '로그인 실패',
        message: '구글 로그인 중 오류가 발생했습니다.',
        color: 'red',
      });
      console.error('구글 로그인 오류:', errorMessage);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAnonymousLogin = async () => {
    setAnonymousLoading(true);
    try {
      await anonymousLogin();
      router.push('/home');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      notifications.show({
        title: '로그인 실패',
        message: '익명 로그인 중 오류가 발생했습니다.',
        color: 'red',
      });
      console.error('익명 로그인 오류:', errorMessage);
    } finally {
      setAnonymousLoading(false);
    }
  };

  return (
    <>
      <Text size="lg" fw={500} ta="center" mb="xl">
        로그인
      </Text>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <TextInput
          label="이메일"
          placeholder="your@email.com"
          required
          {...form.getInputProps('email')}
        />
        <PasswordInput
          label="비밀번호"
          placeholder="비밀번호"
          required
          mt="md"
          {...form.getInputProps('password')}
        />

        <Button type="submit" fullWidth mt="xl" loading={emailLoading} color="lightBlue">
          로그인
        </Button>
      </form>

      <Divider label="또는" labelPosition="center" my="lg" />

      <Group grow>
        <Button
          variant="default"
          leftSection={<IconBrandGoogle size={16} />}
          onClick={handleGoogleSignIn}
          loading={googleLoading}
        >
          Google 계정으로 로그인
        </Button>        
        <Button
          variant="subtle"
          leftSection={<IconUserOff size={16} />}
          onClick={handleAnonymousLogin}
          loading={anonymousLoading}
        >
          익명으로 로그인
        </Button>
      </Group>

      <Text size="sm" c="dimmed" ta="center" mt="md">
        <Anchor component={Link} href="/terms" size="sm">
          이용약관
        </Anchor>
      </Text>
    </>
  );
}
