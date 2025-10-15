'use client';

import { Card, Image, Text, Group, Badge, Avatar } from '@mantine/core';
import { useRouter } from 'next/navigation';
import { IconEye, IconThumbUp } from '@tabler/icons-react';

// Interface for content item
interface ContentItem {
  id: string;
  title: string;
  description: string;
  creatorName: string;
  creatorId: string;
  creatorImage?: string;
  image?: string;
  views: number;
  likes: number;
  createdAt: Date;
  tags: string[];
  category: string;
  isNSFW: boolean;
}

interface ContentCardProps {
  content: ContentItem;
}

export function ContentCard({ content }: ContentCardProps) {
  const router = useRouter();
  
  // Format date to readable string
  const formatDate = (date: Date) => {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return '오늘';
    } else if (diffDays === 1) {
      return '어제';
    } else if (diffDays < 7) {
      return `${diffDays}일 전`;
    } else if (diffDays < 30) {
      return `${Math.floor(diffDays / 7)}주 전`;
    } else {
      return `${Math.floor(diffDays / 30)}개월 전`;
    }
  };
  
  // Handle card click to navigate to chat room
  const handleCardClick = () => {
    router.push(`/chat/${content.id}`);
  };
  
  // Handle creator profile click
  const handleCreatorClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    router.push(`/profile/${content.creatorId}`);
  };

  return (
    <Card
      shadow="sm"
      padding="lg"
      radius="md"
      withBorder
      style={{ cursor: 'pointer' }}
      onClick={handleCardClick}
    >
      <Card.Section>
        <Image
          src={content.image || '/placeholder-image.jpg'}
          height={160}
          alt={content.title}
        />
      </Card.Section>

      <Group justify="space-between" mt="md" mb="xs">
        <Text fw={700} lineClamp={1}>{content.title}</Text>
        {content.isNSFW && (
          <Badge color="red" variant="light">
            NSFW
          </Badge>
        )}
      </Group>

      <Text size="sm" c="dimmed" lineClamp={2} mb="md">
        {content.description}
      </Text>

      <Group justify="space-between" mt="md">
        <Group gap="xs" onClick={handleCreatorClick}>
          <Avatar src={content.creatorImage} size="sm" radius="xl" />
          <Text size="sm">{content.creatorName}</Text>
        </Group>
        
        <Group gap="xs">
          <Group gap="xs">
            <IconEye size={16} />
            <Text size="sm">{content.views}</Text>
          </Group>
          <Group gap="xs">
            <IconThumbUp size={16} />
            <Text size="sm">{content.likes}</Text>
          </Group>
        </Group>
      </Group>

      <Group justify="space-between" mt="xs">
        <Text size="xs" c="dimmed">
          {formatDate(content.createdAt)}
        </Text>
        <Badge color="lightBlue" variant="light">
          {content.category}
        </Badge>
      </Group>
    </Card>
  );
}

export default ContentCard;