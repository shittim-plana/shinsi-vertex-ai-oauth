import React, { useState, useRef, useEffect } from 'react'; // Added useState, useRef, useEffect
import { Textarea, ActionIcon, Group, Box, Button, Image as MantineImage, Checkbox, useMantineTheme, useMantineColorScheme, Tooltip } from '@mantine/core'; // Added Tooltip
import { useMediaQuery } from '@mantine/hooks'; // Added useMediaQuery
import { IconSend, IconX, IconSparkles, IconPhoto } from '@tabler/icons-react'; // Added IconSparkles
import { ChatRoom, Character, User, Message } from '@/types/chat'; // Assuming types are in this path
import { notifications } from '@mantine/notifications'; // Added notifications
import { useSettings } from '@/contexts/SettingsContext';
import AutoResizeTextarea, { AutoResizeTextareaRef } from './AutoResizeTextarea'; // Import our custom component
import { useKeyboardHandler } from '@/hooks/useKeyboardHandler'; // Import keyboard handler

// import { Character } from '@/types/character'; // Assuming character types are here - Use Character from chat types
import { Select } from '@mantine/core';
interface MessageInputProps {
  messageList: Message[]; // Define the type of messageList based on your application
  newMessage: string;
  setNewMessage: (value: string) => void;
  sendMessage: (text: string, imageUrl?: string | null) => void; // 타입 변경
  imagePreview: string | null;
  setImagePreview: (value: string | null) => void;
  setImageUpload: (file: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>; // Allow null in ref type
  handleImageSelect: () => void;
  sendingMessage: boolean;
  chatRoom: ChatRoom | null; // Pass the whole chatRoom or specific needed props like isGroupChat, activeCharacterIds
  isPlayerActive: boolean;
  setIsPlayerActive: (value: boolean) => void;
  handleContinueConversation: () => void;
  continuingConversation: boolean;
  characters: Character[]; // List of available personas
  selectedPersonaId: string | null; // Currently selected persona ID
  setSelectedPersonaId: (id: string | null) => void; // Function to set persona ID
  showPersonaSelector: boolean; // Prop to control visibility
  user: User | null; // Correctly define user prop type, allowing null
  showRefineButton?: boolean; // Optional prop to control refine button visibility
}

const MessageInput: React.FC<MessageInputProps> = ({
  messageList,
  newMessage,
  setNewMessage,
  sendMessage,
  imagePreview,
  setImagePreview,
  setImageUpload,
  fileInputRef,
  handleImageSelect,
  sendingMessage,
  chatRoom,
  isPlayerActive,
  setIsPlayerActive,
  handleContinueConversation,
  continuingConversation,
  characters,
  selectedPersonaId,
  setSelectedPersonaId,
  showPersonaSelector, // Destructure the new prop
  user, // Destructure user prop (keep this one)
  showRefineButton = true, // Destructure with default value true
}) => {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`); // Check for mobile viewport
  const [isRefining, setIsRefining] = useState(false); // State for refinement loading
  const { settings } = useSettings();
  const showRefine = settings.showRefineButton;
  
  // 키보드 핸들러 (모바일만)
  const keyboardState = useKeyboardHandler();
  const mobileInputRef = useRef<AutoResizeTextareaRef>(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
  
  // 키보드 표시 시 입력창 스크롤 처리
  useEffect(() => {
    if (isMobile && keyboardState.isKeyboardOpen && mobileInputRef.current) {
      const timer = setTimeout(() => {
        const element = mobileInputRef.current?.getElement();
        element?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [keyboardState.isKeyboardOpen, isMobile]);

  // Calculate right section width based on visibility of refine button
  const desktopRightSectionWidth = showRefine ? 80 : 35; // Width for desktop
  const mobileRightSectionWidth = showRefine ? 80 : 35; // Mobile: send + refine when enabled
  const currentRightSectionWidth = isMobile ? mobileRightSectionWidth : desktopRightSectionWidth;
  const rightPadding = `${currentRightSectionWidth + 20}px`;

  // 데스크톱 키 핸들러 (기존 동작 유지)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendingMessage && (newMessage.trim() || imagePreview)) { // 메시지 또는 이미지가 있을 때만 전송
        sendMessage(newMessage, imagePreview);
      }
    }
  };

  // 모바일 키 핸들러 (Enter는 줄바꿈)
  const handleMobileKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 모바일에서는 Enter 키가 기본적으로 줄바꿈 역할
    // Ctrl+Enter 또는 Cmd+Enter로 전송 (옵션)
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!sendingMessage && (newMessage.trim() || imagePreview)) {
        sendMessage(newMessage, imagePreview);
      }
    }
    // 일반 Enter는 기본 동작(줄바꿈) 허용
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = ''; // Reset file input
    }
  };

  // Function to call the API for refining input
  const refineInput = async () => {
    if (!newMessage.trim() || isRefining || sendingMessage || continuingConversation || !user) return;

    // Determine character context for the API call
    let apiCharacterId = '';
    let apiCharacterName = '캐릭터'; // Default name
    let apiIsBanmal = false; // Default

    // Prioritize selected persona if one is chosen
    if (selectedPersonaId) {
      const persona = characters.find(char => char.id === selectedPersonaId);
      if (persona) {
        apiCharacterId = persona.id;
        apiCharacterName = persona.name;
        apiIsBanmal = persona.isBanmal;
      } else {
        console.warn(`Selected persona ${selectedPersonaId} not found in characters list. Falling back to chat room character.`);
        // Fallback to chat room character logic if persona not found
        if (chatRoom?.isGroupChat && chatRoom.characters && chatRoom.characters.length > 0) {
          const firstActiveCharId = chatRoom.activeCharacterIds?.[0];
          const firstActiveChar = chatRoom.characters.find(c => c.id === firstActiveCharId);
          const firstChar = chatRoom.characters[0];
          if (firstActiveChar) {
            apiCharacterId = firstActiveChar.id;
            apiCharacterName = firstActiveChar.name;
            apiIsBanmal = firstActiveChar.isBanmal;
          } else if (firstChar) {
            apiCharacterId = firstChar.id;
            apiCharacterName = firstChar.name;
            apiIsBanmal = firstChar.isBanmal;
          }
        } else if (chatRoom?.character) {
          apiCharacterId = chatRoom.character.id;
          apiCharacterName = chatRoom.character.name;
          apiIsBanmal = chatRoom.character.isBanmal;
        }
      }
    } else {

    }

    // No persona selected, use chat room character logic
    if (chatRoom?.isGroupChat && chatRoom.characters && chatRoom.characters.length > 0) {
      const firstActiveCharId = chatRoom.activeCharacterIds?.[0];
      const firstActiveChar = chatRoom.characters.find(c => c.id === firstActiveCharId);
      const firstChar = chatRoom.characters[0];
      if (firstActiveChar) {
        apiCharacterId = firstActiveChar.id;
        apiCharacterName = firstActiveChar.name;
        apiIsBanmal = firstActiveChar.isBanmal;
      } else if (firstChar) {
        apiCharacterId = firstChar.id;
        apiCharacterName = firstChar.name;
        apiIsBanmal = firstChar.isBanmal;
      }
    } else if (chatRoom?.character) {
      apiCharacterId = chatRoom.character.id;
      apiCharacterName = chatRoom.character.name;
      apiIsBanmal = chatRoom.character.isBanmal;
    }

    setIsRefining(true);
    try {
      const lastMessage = messageList[messageList.length - 1]
      const response = await fetch('/api/chat/bot-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Use the determined character context
          roomId: chatRoom?.id,
          characterId: lastMessage.id,
          characterName: lastMessage.senderName,
          senseiName: user?.displayName || '선생님', // Use user's display name
          characterInfo: {
            characterId: apiCharacterId,
            isBanmal: apiIsBanmal,
          },
          lastMessage: newMessage, // Use the current input as the "last message" for refinement context
          inputText: `${newMessage}\n (OOC: ${apiCharacterName}의 관점에서 방금 전의 메시지를 개선해주세요.)`, // Keep the original text for potential backend use
          isNSFW: chatRoom?.isNSFW || false,
          enableNSFW: settings.enableNSFW,
          isBanmal: apiIsBanmal,
          userId: user?.uid,
          lorebookIds: chatRoom?.lorebookIds || [],
          isInputImprove: true
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Refinement API Error:", errorBody);
        throw new Error(`Failed to refine input: ${response.statusText}`);
      }

      const data = await response.json();
      const refinedText = data.refinedText || data.response; // Adjust based on actual API response key

      if (refinedText && typeof refinedText === 'string') {
        setNewMessage(refinedText); // Update the input field with refined text
        notifications.show({
          title: '입력 개선 완료',
          message: '텍스트가 개선되었습니다.',
          color: 'teal',
          icon: <IconSparkles size={16} />,
        });
      } else {
        console.warn("Refined text not found or invalid in API response:", data);
        notifications.show({
          title: '개선 실패',
          message: 'API 응답에서 유효한 텍스트를 찾을 수 없습니다.',
          color: 'orange',
        });
      }

    } catch (error) {
      console.error('Error refining input:', error);
      notifications.show({
        title: '입력 개선 오류',
        message: `텍스트 개선 중 오류 발생: ${error instanceof Error ? error.message : '알 수 없는 오류'}`,
        color: 'red',
      });
    } finally {
      setIsRefining(false);
    }
  };


  return (
    <>
      {/* Desktop Input */}
      <Box
        display={{ base: 'none', sm: 'block' }}
        p="xs"
        pt="md"
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${colorScheme === 'dark' ? theme.colors.dark[4] : theme.colors.gray[3]}`,
          backgroundColor: colorScheme === 'dark' ? theme.colors.dark[7] : theme.white,
        }}
      >
        {imagePreview && (
          <Box mb="sm" pos="relative" w={100} h={100}>
            <MantineImage
              src={imagePreview}
              alt="Preview"
              radius="sm"
              height={100}
              width={100}
              fit="cover"
            />
            <ActionIcon
              variant="filled"
              color="red"
              size="sm"
              onClick={clearImage}
              style={{ position: 'absolute', top: 5, right: 5 }}
              radius="xl"
            >
              <IconX size={14} />
            </ActionIcon>
          </Box>
        )}
        {/* Persona Selector - Desktop (Conditional Rendering) */}
        {showPersonaSelector && characters && characters.length > 0 && (
          <Select
            placeholder="페르소나 선택"
            value={selectedPersonaId}
            onChange={(value) => setSelectedPersonaId(value)}
            data={characters.map(char => ({ value: char.id, label: char.name }))}
            searchable // Enable search
            nothingFoundMessage="페르소나를 찾을 수 없습니다." // Message when no results
            disabled={sendingMessage || continuingConversation}
            mb="xs" // Add margin-bottom instead of margin-top
            clearable
          />
        )}
        <Box pos="relative">
          <Group>
          <ActionIcon size="lg" variant="subtle" onClick={handleImageSelect} disabled={sendingMessage || continuingConversation || isRefining}>
            <IconPhoto size={20} />
          </ActionIcon>
          <Textarea
            style={{ flex: 1 }}
            placeholder="메시지를 입력하세요..."
            value={newMessage}
            onChange={(event) => setNewMessage(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autosize
            minRows={1}
            maxRows={5}
            disabled={sendingMessage || continuingConversation || isRefining} // Disable while refining
            rightSectionWidth={desktopRightSectionWidth} // Use calculated desktop width
            rightSection={
              <Group gap="xs" wrap="nowrap" align="flex-end">
                {/* Refine Button (Conditional) */}
                {showRefine &&
                  <Tooltip label="입력 내용 개선하기" withArrow position="top">
                    <ActionIcon
                      size="lg"
                      variant="subtle" // Use subtle variant for less emphasis
                      onClick={refineInput}
                      loading={isRefining}
                      disabled={!newMessage.trim() || sendingMessage || continuingConversation || isRefining}
                    >
                      <IconSparkles size={20} />
                    </ActionIcon>
                  </Tooltip>
                }
                {/* Send Button */}
                <ActionIcon
                  size="lg"
                  variant="filled"
                  color="blue"
                  onClick={() => sendMessage(newMessage, imagePreview)} // 호출 시 인자 전달
                  loading={sendingMessage}
                  disabled={(!newMessage.trim() && !imagePreview) || continuingConversation || isRefining} // Disable while refining
                 >
                  <IconSend size={20} />
                </ActionIcon>
              </Group>
            }
            styles={{
              input: {
                paddingRight: rightPadding, // Use calculated padding
              },
            }}
          />
          </Group>
        </Box>

        {/* Group Chat Specific Controls - Desktop */}
        {chatRoom?.isGroupChat && (
          <Group justify="space-between" mt="xs">
            <Checkbox
              label="플레이어 참여"
              checked={isPlayerActive}
              onChange={(event) => setIsPlayerActive(event.currentTarget.checked)}
              disabled={sendingMessage || continuingConversation || isRefining} // Disable while refining
            />
            {!isPlayerActive && chatRoom.activeCharacterIds && chatRoom.activeCharacterIds.length > 0 && (
              <Button
                size="xs"
                variant="light"
                onClick={handleContinueConversation}
                loading={continuingConversation}
                disabled={sendingMessage || isRefining} // Disable while refining
              >
                이어하기
              </Button>
            )}
          </Group>
        )}
      </Box>

      {/* Mobile Input (Flexbox based layout) */}
      <Box
        ref={mobileContainerRef}
        display={{ base: 'block', sm: 'none' }}
        w="100%"
        style={{
          flexShrink: 0,
          padding: theme.spacing.xs,
          paddingBottom: `calc(${theme.spacing.xs} + env(safe-area-inset-bottom))`,
          borderTop: `1px solid ${theme.colors.dark[4]}`,
          backgroundColor: colorScheme === 'dark' ? theme.colors.dark[7] : theme.white,
        }}
      >
        {imagePreview && (
          <Box mb="sm" pos="relative" w={80} h={80}>
             <MantineImage
              src={imagePreview}
              alt="Preview"
              radius="sm"
              height={80}
              width={80}
              fit="cover"
            />
            <ActionIcon
              variant="filled"
              color="red"
              size="xs"
              onClick={clearImage}
              style={{ position: 'absolute', top: 3, right: 3 }}
              radius="xl"
            >
              <IconX size={12} />
            </ActionIcon>
          </Box>
        )}
         {/* Persona Selector - Mobile (Conditional Rendering) */}
         {showPersonaSelector && characters && characters.length > 0 && (
          <Select
            placeholder="페르소나 선택"
            value={selectedPersonaId}
            onChange={(value) => setSelectedPersonaId(value)}
            data={characters.map(char => ({ value: char.id, label: char.name }))}
            searchable // Enable search
            nothingFoundMessage="페르소나를 찾을 수 없습니다." // Message when no results
            disabled={sendingMessage || continuingConversation}
            mb="xs" // Add margin-bottom instead of margin-top
            size="xs"
            clearable
          />
        )}
        <Box pos="relative" w="100%">
          <Group gap="xs" wrap="nowrap" align="flex-start" style={{ display: 'flex', width: '100%' }}>
            <ActionIcon
              size="lg"
              variant="subtle"
              onClick={handleImageSelect}
              disabled={sendingMessage || continuingConversation || isRefining}
            >
              <IconPhoto size={20} />
            </ActionIcon>
            <AutoResizeTextarea
              ref={mobileInputRef}
              placeholder="메시지를 입력하세요..."
              value={newMessage}
              onChange={(event) => setNewMessage(event.currentTarget.value)}
              onKeyDown={handleMobileKeyDown}
              disabled={sendingMessage || continuingConversation || isRefining}
              maxRows={5}
              rightSectionWidth={currentRightSectionWidth}
              rightSection={
                <Group gap="xs" wrap="nowrap" align="flex-end" pb={5}>
                  {showRefine && (
                    <Tooltip label="입력 내용 개선하기" withArrow position="top">
                      <ActionIcon
                        size="lg"
                        variant="subtle"
                        onClick={refineInput}
                        loading={isRefining}
                        disabled={!newMessage.trim() || sendingMessage || continuingConversation || isRefining}
                      >
                        <IconSparkles size={20} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon
                    size="lg"
                    variant="filled"
                    color="blue"
                    onClick={() => sendMessage(newMessage, imagePreview)}
                    loading={sendingMessage}
                    disabled={(!newMessage.trim() && !imagePreview) || continuingConversation || isRefining}
                  >
                    <IconSend size={20} />
                  </ActionIcon>
                </Group>
              }
              style={{ flex: 1, width: '100%' }}
              styles={{
                input: {
                  paddingRight: rightPadding,
                },
              }}
            />
          </Group>
        </Box>
         {/* Group Chat Specific Controls - Mobile */}
         {chatRoom?.isGroupChat && (
          <Group justify="space-between" mt="xs">
             <Checkbox
              label="플레이어 참여"
              checked={isPlayerActive}
              onChange={(event) => setIsPlayerActive(event.currentTarget.checked)}
              disabled={sendingMessage || continuingConversation || isRefining} // Disable while refining
              size="xs" // Smaller checkbox for mobile
            />
            {!isPlayerActive && chatRoom.activeCharacterIds && chatRoom.activeCharacterIds.length > 0 && (
               <Button
                size="xs"
                variant="light"
                onClick={handleContinueConversation}
                loading={continuingConversation}
                disabled={sendingMessage || isRefining} // Disable while refining
              >
                이어하기
              </Button>
            )}
          </Group>
        )}
      </Box>
    </>
  );
};

export default MessageInput;
