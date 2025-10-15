'use client';
import React, { useState, useRef, useEffect } from 'react';
import { Textarea, ActionIcon, Group, Box, Button, Image as MantineImage, Checkbox, Select, Tooltip, Grid } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconSend, IconX, IconSparkles, IconPhoto } from '@tabler/icons-react';
// 로컬 타입 선언: 실제 프로젝트의 타입과 맞지 않아 발생하는 TS 오류를 우회하기 위해 최소 필드만 정의
type Message = {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string;
  isCharacter: boolean;
  characterId: string;
  text: string;
  imageUrl?: string;
  generatedImageUrl?: string | null;
  imageGenPrompt?: string | null;
  imageError?: boolean;
  timestamp: Date;
  imageData?: unknown;
};

type Character = {
  id: string;
  name: string;
  description?: string;
  creatorId?: string;
  image?: string;
  additionalImages?: string[];
  detail?: string;
  firstMessage?: string;
  isNSFW?: boolean;
  isBanmal?: boolean;
  tags?: string[];
  conversationCount?: number;
  likesCount?: number;
  likedBy?: string[];
};

type ChatRoom = {
  id: string;
  name: string;
  description?: string;
  creatorId?: string;
  creatorName?: string;
  image?: string;
  characterId?: string;
  characterIds?: string[];
  isGroupChat: boolean;
  activeCharacterIds?: string[];
  nextSpeakerIndex?: number;
  isNSFW?: boolean;
  lastUpdated?: Date;
  members?: number;
  tags?: string[];
  lorebookIds?: string[];
  characters?: Character[];
  character?: Character;
  autoConvertToPrivate?: boolean;
};

type User = {
  uid: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
};
import { notifications } from '@mantine/notifications';
import { useSettings } from '@/contexts/SettingsContext';
import AutoResizeTextarea, { AutoResizeTextareaRef } from '../AutoResizeTextarea';
import { useKeyboardHandler } from '@/hooks/useKeyboardHandler';
import styles from './novel.module.css';

interface NovelMessageInputProps {
  messageList: Message[];
  newMessage: string;
  setNewMessage: (value: string) => void;
  sendMessage: (text: string, imageUrl?: string | null) => void;
  imagePreview: string | null;
  setImagePreview: (value: string | null) => void;
  setImageUpload: (file: File | null) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleImageSelect: () => void;
  sendingMessage: boolean;
  chatRoom: ChatRoom | null;
  isPlayerActive: boolean;
  setIsPlayerActive: (value: boolean) => void;
  handleContinueConversation: () => void;
  continuingConversation: boolean;
  characters: Character[];
  selectedPersonaId: string | null;
  setSelectedPersonaId: (id: string | null) => void;
  showPersonaSelector: boolean;
  user: User | null;
  showRefineButton?: boolean;
}

const NovelMessageInput: React.FC<NovelMessageInputProps> = ({
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
  showPersonaSelector,
  user,
  showRefineButton = true,
}) => {
  const isMobile = useMediaQuery('(max-width: 768px)');
  const [isRefining, setIsRefining] = useState(false);
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
  const desktopRightSectionWidth = showRefine ? 80 : 35;
  const mobileRightSectionWidth = showRefine ? 80 : 35;
  const currentRightSectionWidth = isMobile ? mobileRightSectionWidth : desktopRightSectionWidth;

  // 데스크톱 키 핸들러
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!sendingMessage && (newMessage.trim() || imagePreview)) {
        sendMessage(newMessage, imagePreview);
      }
    }
  };

  // 모바일 키 핸들러
  const handleMobileKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (!sendingMessage && (newMessage.trim() || imagePreview)) {
        sendMessage(newMessage, imagePreview);
      }
    }
  };

  const clearImage = () => {
    setImagePreview(null);
    setImageUpload(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Function to call the API for refining input
  const refineInput = async () => {
    if (!newMessage.trim() || isRefining || sendingMessage || continuingConversation || !user) return;

    // Determine character context for the API call
    let apiCharacterId = '';
    let apiCharacterName = '캐릭터';
    let apiIsBanmal = false;

    // Prioritize selected persona if one is chosen
    if (selectedPersonaId) {
      const persona = characters.find(char => char.id === selectedPersonaId);
      if (persona) {
        apiCharacterId = persona.id;
        apiCharacterName = persona.name;
        apiIsBanmal = persona.isBanmal || false;
      } else {
        console.warn(`Selected persona ${selectedPersonaId} not found in characters list. Falling back to chat room character.`);
        if (chatRoom?.isGroupChat && chatRoom.characters && chatRoom.characters.length > 0) {
          const firstActiveCharId = chatRoom.activeCharacterIds?.[0];
          const firstActiveChar = chatRoom.characters.find(c => c.id === firstActiveCharId);
          const firstChar = chatRoom.characters[0];
          if (firstActiveChar) {
            apiCharacterId = firstActiveChar.id;
            apiCharacterName = firstActiveChar.name;
            apiIsBanmal = firstActiveChar.isBanmal || false;
          } else if (firstChar) {
            apiCharacterId = firstChar.id;
            apiCharacterName = firstChar.name;
            apiIsBanmal = firstChar.isBanmal || false;
          }
        } else if (chatRoom?.character) {
          apiCharacterId = chatRoom.character.id;
          apiCharacterName = chatRoom.character.name;
          apiIsBanmal = chatRoom.character.isBanmal || false;
        }
      }
    } else {
      // No persona selected, use chat room character logic
      if (chatRoom?.isGroupChat && chatRoom.characters && chatRoom.characters.length > 0) {
        const firstActiveCharId = chatRoom.activeCharacterIds?.[0];
        const firstActiveChar = chatRoom.characters.find(c => c.id === firstActiveCharId);
        const firstChar = chatRoom.characters[0];
        if (firstActiveChar) {
          apiCharacterId = firstActiveChar.id;
          apiCharacterName = firstActiveChar.name;
          apiIsBanmal = firstActiveChar.isBanmal || false;
        } else if (firstChar) {
          apiCharacterId = firstChar.id;
          apiCharacterName = firstChar.name;
          apiIsBanmal = firstChar.isBanmal || false;
        }
      } else if (chatRoom?.character) {
        apiCharacterId = chatRoom.character.id;
        apiCharacterName = chatRoom.character.name;
        apiIsBanmal = chatRoom.character.isBanmal || false;
      }
    }

    setIsRefining(true);
    try {
      const lastMessage = messageList[messageList.length - 1]
      const response = await fetch('/api/chat/bot-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: chatRoom?.id,
          characterId: lastMessage.id,
          characterName: lastMessage.senderName,
          senseiName: user?.displayName || '선생님',
          characterInfo: {
            characterId: apiCharacterId,
            isBanmal: apiIsBanmal,
          },
          lastMessage: newMessage,
          inputText: `${newMessage}\n (OOC: ${apiCharacterName}의 관점에서 방금 전의 메시지를 개선해주세요.)`,
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
      const refinedText = data.refinedText || data.response;

      if (refinedText && typeof refinedText === 'string') {
        setNewMessage(refinedText);
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
        className={styles.novelMessageInput}
      >
        {imagePreview && (
          <Box mb="sm" className={`${styles.imagePreview} ${styles.imagePreviewDesktop}`}>
            <MantineImage
              src={imagePreview}
              alt="미리보기"
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
              className={styles.imagePreviewCloseButton}
              radius="xl"
            >
              <IconX size={14} />
            </ActionIcon>
          </Box>
        )}
        
        {/* Persona Selector - Desktop */}
        {showPersonaSelector && characters && characters.length > 0 && (
          <Select
            placeholder="페르소나 선택"
            value={selectedPersonaId}
            onChange={(value) => setSelectedPersonaId(value)}
            data={characters.map(char => ({ value: char.id, label: char.name }))}
            searchable
            nothingFoundMessage="페르소나를 찾을 수 없습니다."
            disabled={sendingMessage || continuingConversation}
            mb="xs"
            clearable
            className={`${styles.glassEffect} ${styles.personaSelector}`}
          />
        )}
        
        <Box pos="relative" w="100%">
          <Grid>
            <Grid.Col span={1}>
            <ActionIcon 
              size="lg" 
              variant="subtle" 
              onClick={handleImageSelect} 
              disabled={sendingMessage || continuingConversation || isRefining}
              className={styles.glassEffect}
            >
              <IconPhoto size={20} />
            </ActionIcon>
            </Grid.Col>
            <Grid.Col span={11}>
            <Textarea
              className={`${styles.textareaFlex} ${styles.glassEffect} ${styles.textareaMain}`}
              placeholder="메시지를 입력하세요..."
              value={newMessage}
              onChange={(event) => setNewMessage(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              autosize
              minRows={1}
              maxRows={5}
              disabled={sendingMessage || continuingConversation || isRefining}
              rightSectionWidth={desktopRightSectionWidth}
              rightSection={
                <Group gap="xs" wrap="nowrap" align="flex-end">
                  {/* Refine Button */}
                  {showRefine && (
                    <Tooltip label="입력 내용 개선하기" withArrow position="top">
                      <ActionIcon
                        size="lg"
                        variant="subtle"
                        onClick={refineInput}
                        loading={isRefining}
                        disabled={!newMessage.trim() || sendingMessage || continuingConversation || isRefining}
                        className={styles.glassEffect}
                      >
                        <IconSparkles size={20} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  {/* Send Button */}
                  <ActionIcon
                    size="lg"
                    variant="filled"
                    onClick={() => sendMessage(newMessage, imagePreview)}
                    loading={sendingMessage}
                    disabled={(!newMessage.trim() && !imagePreview) || continuingConversation || isRefining}
                    className={`${styles.glassEffect} ${styles.sendButton}`}
                  >
                    <IconSend size={20} />
                  </ActionIcon>
                </Group>
              }
              data-right-section-width={desktopRightSectionWidth}
            />
            </Grid.Col>
          </Grid>
        </Box>

        {/* Group Chat Specific Controls - Desktop */}
        {chatRoom?.isGroupChat && (
          <Group justify="space-between" mt="xs">
            <Checkbox
              label="플레이어 참여"
              checked={isPlayerActive}
              onChange={(event) => setIsPlayerActive(event.currentTarget.checked)}
              disabled={sendingMessage || continuingConversation || isRefining}
              className={styles.groupChatCheckbox}
            />
            {!isPlayerActive && chatRoom.activeCharacterIds && chatRoom.activeCharacterIds.length > 0 && (
              <Button
                size="xs"
                variant="light"
                onClick={handleContinueConversation}
                loading={continuingConversation}
                disabled={sendingMessage || isRefining}
                className={`${styles.glassEffect} ${styles.continueButton}`}
              >
                이어하기
              </Button>
            )}
          </Group>
        )}
      </Box>

      {/* Mobile Input */}
      <Box
        ref={mobileContainerRef}
        display={{ base: 'block', sm: 'none' }}
        w="100%"
        className={`${styles.novelMessageInput} ${styles.mobileInputContainer} ${styles.mobileDarkBar}`}
      >
        {imagePreview && (
          <Box mb="sm" className={`${styles.imagePreview} ${styles.imagePreviewMobile}`}>
            <MantineImage
              src={imagePreview}
              alt="미리보기"
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
              className={styles.imagePreviewCloseButtonMobile}
              radius="xl"
            >
              <IconX size={12} />
            </ActionIcon>
          </Box>
        )}
        
        {/* Persona Selector - Mobile */}
        {showPersonaSelector && characters && characters.length > 0 && (
          <Select
            placeholder="페르소나 선택"
            value={selectedPersonaId}
            onChange={(value) => setSelectedPersonaId(value)}
            data={characters.map(char => ({ value: char.id, label: char.name }))}
            searchable
            nothingFoundMessage="페르소나를 찾을 수 없습니다."
            disabled={sendingMessage || continuingConversation}
            mb="xs"
            size="xs"
            clearable
            className={`${styles.glassEffect} ${styles.personaSelector}`}
          />
        )}
        
        <Box pos="relative" w="100%">
          <Group gap="xs" wrap="nowrap" align="flex-start" className={styles.inputGroup}>
            <ActionIcon
              size="lg"
              variant="subtle"
              onClick={handleImageSelect}
              disabled={sendingMessage || continuingConversation || isRefining}
              className={styles.glassEffect}
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
                        className={styles.glassEffect}
                      >
                        <IconSparkles size={20} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                  <ActionIcon
                    size="lg"
                    variant="filled"
                    onClick={() => sendMessage(newMessage, imagePreview)}
                    loading={sendingMessage}
                    disabled={(!newMessage.trim() && !imagePreview) || continuingConversation || isRefining}
                    className={`${styles.glassEffect} ${styles.sendButton}`}
                  >
                    <IconSend size={20} />
                  </ActionIcon>
                </Group>
              }
              className={`${styles.textareaContainer} ${styles.glassEffect}`}
              data-right-section-width={currentRightSectionWidth}
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
              disabled={sendingMessage || continuingConversation || isRefining}
              size="xs"
              className={styles.groupChatCheckbox}
            />
            {!isPlayerActive && chatRoom.activeCharacterIds && chatRoom.activeCharacterIds.length > 0 && (
              <Button
                size="xs"
                variant="light"
                onClick={handleContinueConversation}
                loading={continuingConversation}
                disabled={sendingMessage || isRefining}
                className={`${styles.glassEffect} ${styles.continueButton}`}
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

export default NovelMessageInput;