import React from 'react';
import { Button, Tooltip, Badge, Group } from '@mantine/core';
import { IconUsers, IconUser, IconArrowsExchange } from '@tabler/icons-react';
import { ChatRoom } from '@/types/chat';

interface ConversionButtonProps {
  chatRoom: ChatRoom | null;
  onConvert: (settings: {
    fromType: 'group' | 'private';
    toType: 'group' | 'private';
    auto: boolean;
  }) => void;
  onOpenSettings: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export default function ConversionButton({
  chatRoom,
  onConvert,
  onOpenSettings,
  disabled = false,
  compact = false
}: ConversionButtonProps) {
  // chatRoom이 없으면 렌더링하지 않음
  if (!chatRoom) return null;

  // chatRoom에서 필요한 값들 추론
  const currentType = chatRoom.isGroupChat ? 'group' : 'private';
  const activeCharacterCount = chatRoom.activeCharacterIds?.length || 0;
  
  // canConvert 로직: 그룹에서 개인으로는 활성 캐릭터가 1-2명일 때, 개인에서 그룹으로는 항상 가능
  const canConvert = currentType === 'group'
    ? activeCharacterCount >= 1 && activeCharacterCount <= 2
    : activeCharacterCount >= 1;
  const isGroup = currentType === 'group';
  const targetType = isGroup ? 'private' : 'group';
  
  const getButtonText = () => {
    if (compact) {
      return isGroup ? '개인' : '그룹';
    }
    return isGroup ? '개인 채팅으로 전환' : '그룹 채팅으로 전환';
  };

  const getIcon = () => {
    return targetType === 'private' ? <IconUser size={16} /> : <IconUsers size={16} />;
  };

  const getTooltipText = () => {
    if (!canConvert) {
      if (isGroup && activeCharacterCount === 0) {
        return '활성 캐릭터가 없어 전환할 수 없습니다.';
      }
      if (isGroup && activeCharacterCount > 2) {
        return '활성 캐릭터가 2명 이하일 때 개인 채팅으로 전환 가능합니다.';
      }
    }
    
    if (isGroup) {
      return `현재 활성 캐릭터 ${activeCharacterCount}명과의 개인 채팅으로 전환`;
    } else {
      return '현재 캐릭터를 포함한 그룹 채팅으로 전환';
    }
  };

  const showAutoConvertSuggestion = isGroup && activeCharacterCount === 1;

  // onConvert 호출 시 설정 객체 전달
  const handleConvert = () => {
    onConvert({
      fromType: currentType,
      toType: targetType,
      auto: false
    });
  };

  const button = (
    <Button
      variant="light"
      color={targetType === 'private' ? 'blue' : 'green'}
      leftSection={getIcon()}
      rightSection={showAutoConvertSuggestion && <Badge size="xs" color="orange">자동 전환 가능</Badge>}
      onClick={handleConvert}
      disabled={disabled || !canConvert}
      size={compact ? 'xs' : 'sm'}
    >
      <Group gap="xs">
        {getButtonText()}
        {!compact && <IconArrowsExchange size={14} />}
      </Group>
    </Button>
  );

  if (!canConvert || showAutoConvertSuggestion) {
    return (
      <Tooltip label={getTooltipText()} multiline w={200}>
        {button}
      </Tooltip>
    );
  }

  return button;
}