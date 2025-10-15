'use client';

import { Paper, Text, Button, Group, CloseButton } from '@mantine/core';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface NotificationBannerProps {
  title: string;
  description: string;
  buttonText?: string;
  buttonLink?: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
}

export function NotificationBanner({
  title,
  description,
  buttonText,
  buttonLink,
  variant = 'info',
}: NotificationBannerProps) {
  const [visible, setVisible] = useState(true);
  const router = useRouter();

  if (!visible) {
    return null;
  }

  // Get variant color
  const getVariantColor = () => {
    switch (variant) {
      case 'success':
        return 'green';
      case 'warning':
        return 'yellow';
      case 'error':
        return 'red';
      case 'info':
      default:
        return 'lightBlue';
    }
  };

  // Handle button click
  const handleClick = () => {
    if (buttonLink) {
      router.push(buttonLink);
    }
  };

  return (
    <Paper
      withBorder
      p="md"
      mb="xl"
      radius="md"
      style={{
        borderLeftWidth: 4,
        borderLeftColor: `var(--mantine-color-${getVariantColor()}-6)`,
      }}
    >
      <Group justify="space-between" mb="xs">
        <Text fw={500} size="md">
          {title}
        </Text>
        <CloseButton
          onClick={() => setVisible(false)}
          aria-label="Close notification"
        />
      </Group>
      <Text size="sm" color="dimmed" mb="md">
        {description}
      </Text>
      {buttonText && buttonLink && (
        <Button
          variant="light"
          color={getVariantColor()}
          onClick={handleClick}
          size="sm"
        >
          {buttonText}
        </Button>
      )}
    </Paper>
  );
}

export default NotificationBanner;