'use client';

import { useState } from 'react';
import { TextInput, PasswordInput, Button, Divider, Group, Text, Anchor } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { IconBrandGoogle, IconUserOff } from '@tabler/icons-react';
import { notifications } from '@mantine/notifications';

export default function SignupPage() {
  const [loading, setLoading] = useState(false);
  const { signUp, googleSignIn, anonymousLogin } = useAuth();
  const router = useRouter();

  const form = useForm({
    initialValues: {
      email: '',
      displayName: '',
      password: '',
      confirmPassword: '',
    },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '유효한 이메일을 입력해주세요'),
      displayName: (value) => (value.length >= 2 ? null : '이름은 최소 2자 이상이어야 합니다'),
      password: (value) => (value.length >= 6 ? null : '비밀번호는 최소 6자 이상이어야 합니다'),
      confirmPassword: (value, values) =>
        value === values.password ? null : '비밀번호가 일치하지 않습니다',
    },
  });

  const handleSubmit = async (values: typeof form.values) => {
    setLoading(true);
    try {
      await signUp(values.email, values.password, values.displayName);
      notifications.show({
        title: '회원가입 성공',
        message: '환영합니다! 이제 로그인해주세요.',
        color: 'green',
      });
      router.push('/login');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      notifications.show({
        title: '회원가입 실패',
        message: '이미 사용 중인 이메일이거나 다른 오류가 발생했습니다.',
        color: 'red',
      });
      console.error('회원가입 오류:', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    try {
      await googleSignIn();
      router.push('/home');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
      notifications.show({
        title: '가입 실패',
        message: '구글 계정으로 가입 중 오류가 발생했습니다.',
        color: 'red',
      });
      console.error('구글 가입 오류:', errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymousLogin = async () => {
    setLoading(true);
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
      setLoading(false);
    }
  };

  return (
    <>
      <Text size="lg" fw={500} ta="center" mb="xl">
        회원가입
      </Text>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <TextInput
          label="이메일"
          placeholder="your@email.com"
          required
          {...form.getInputProps('email')}
        />
        <TextInput
          label="닉네임"
          placeholder="닉네임"
          required
          mt="md"
          {...form.getInputProps('displayName')}
        />
        <PasswordInput
          label="비밀번호"
          placeholder="비밀번호"
          required
          mt="md"
          {...form.getInputProps('password')}
        />
        <PasswordInput
          label="비밀번호 확인"
          placeholder="비밀번호 확인"
          required
          mt="md"
          {...form.getInputProps('confirmPassword')}
        />

        <Button type="submit" fullWidth mt="xl" loading={loading} color="lightBlue">
          회원가입
        </Button>
      </form>

      <Text size="sm" c="dimmed" ta="center" mt="md">
        가입을 진행하면 서비스의{' '}
        <Anchor component={Link} href="/terms" size="sm">
          이용약관
        </Anchor>
        에 동의한 것으로 간주합니다.
      </Text>

      <Divider label="또는" labelPosition="center" my="lg" />

      <Group grow>
        <Button
          variant="default"
          leftSection={<IconBrandGoogle size={16} />}
          onClick={handleGoogleSignIn}
          loading={loading}
        >
          Google 계정으로 가입
        </Button>

        <Button
          variant="subtle"
          leftSection={<IconUserOff size={16} />}
          onClick={handleAnonymousLogin}
          loading={loading}
        >
          익명으로 계속하기
        </Button>
      </Group>
    </>
  );
}