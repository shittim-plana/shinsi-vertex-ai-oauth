'use client';

import React, { useState, useEffect, ClipboardEvent, DragEvent, useMemo } from 'react'; // Added DragEvent, useMemo
import { Paper, Stepper, Group, Button, TextInput, Textarea, Switch, MultiSelect, FileInput, Stack, Image, Text, Tabs, Divider, Badge, Box, Modal, ActionIcon, Tooltip, LoadingOverlay, Select, Anchor, Alert, Code, NumberInput, CopyButton } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { uploadFileAndGetUrl, dataUrlToFile } from '@/utils/storage-utils';
import { useAuth } from '@/contexts/AuthContext';
import { IconUpload, IconX, IconCrop, IconPhoto, IconWand, IconBook, IconAlertTriangle, IconInfoCircle, IconCopy, IconCheck } from '@tabler/icons-react'; // IconBook 추가
import ImageCropper from '@/components/image/ImageCropper';
import { Character } from '@/types/character';
import { LorebookEntry } from '@/types/lorebook';
import type { GenerateLoreResponse } from '@/types/lore';
import type { Gallery } from '@/types/gallery';
// db, collection, query, where, getDocs, orderBy 제거
import { useAccessibleLorebooks } from '@/hooks/useAccessibleLorebooks'; // Hook 임포트
import classes from './CharacterForm.module.css';
import Cookies from 'js-cookie';
import { userAgent } from 'next/server';
import { db } from '@/firebase/config';
import { doc, setDoc } from 'firebase/firestore';

// MultiSelect 데이터 형식 정의
interface LorebookSelectItem {
  value: string; // Lorebook ID
  label: string; // Lorebook Title
}

export interface CharacterFormValues {
  name: string;
  description: string;
  mainImage: File | null;
  additionalImages: File[];
  detail: string;
  firstMessage: string;
  tags: string[];
  isPublic: boolean;
  isNSFW: boolean;
  isBanmal: boolean;
  lorebookIds: string[];
  requiredImageTags: string;
  // 포인트 시스템 연동 필드
  isPremiumChat: boolean;
  chatPointCost: number;

  // 갤러리(감정 배경) 메타: 추가 이미지에 대한 태그/가중치
  additionalImageTags: Record<number, string[]>; // index -> tags
  additionalImageWeights: Record<number, number>; // index -> weight

  // Phase1: 캐릭터별 커스텀 감정 라벨(국문)
  customEmotions: string[];
}

interface CharacterFormProps {
  mode: 'create' | 'edit';
  initialData?: Character | null;
  initialGalleryData?: Gallery | null;
  onSubmit: (values: CharacterFormValues, mainImageUrl: string, additionalImageUrls: string[]) => Promise<string | void>; // Return character ID on create
  loading: boolean;
}

const initialTagSuggestions = [
  '친근한', '도움이 되는', '창의적인', '지적인'
];

export default function CharacterForm({ mode, initialData, initialGalleryData, onSubmit, loading }: CharacterFormProps) {
  const [active, setActive] = useState(0);
  const [mainImagePreview, setMainImagePreview] = useState<string | null>(initialData?.image || null);
  const [additionalImagePreviews, setAdditionalImagePreviews] = useState<string[]>(initialData?.additionalImages || []);
  const [detailLength, setDetailLength] = useState(0);
  const [firstMessageLength, setFirstMessageLength] = useState(0);
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null); // File selected for cropping or original use
  const [isCroppingMainImage, setIsCroppingMainImage] = useState(true); // Track if cropping main or additional image
  const [currentTags, setCurrentTags] = useState<string[]>([]);
  const [searchValue, setSearchValue] = useState('');
  const [emotionSearchValue, setEmotionSearchValue] = useState('');

  const [wikiContent, setWikiContent] = useState('');
  const [isGeneratingLore, setIsGeneratingLore] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-2.5-flash-preview-04-17'); // Default model

  const PAID_MODELS = useMemo(() => new Set(['gemini-2.5-pro']), []);
  const [genResult, setGenResult] = useState<{ lore: string; firstMessage: string } | null>(null);
  const [genMeta, setGenMeta] = useState<GenerateLoreResponse['meta'] | null>(null);
  const [genError, setGenError] = useState<{ status?: number; code?: string; message?: string; required?: number; balance?: number } | null>(null);
  const [lastRequestId, setLastRequestId] = useState<string | undefined>(undefined);
  // States to manage image selection options
  const [tempMainImageFile, setTempMainImageFile] = useState<File | null>(null);
  const [showMainImageOptions, setShowMainImageOptions] = useState(false);
  const [tempAdditionalImageFile, setTempAdditionalImageFile] = useState<File | null>(null);
  const [showAdditionalImageOptions, setShowAdditionalImageOptions] = useState(false);
  // 로어북 상태는 hook에서 가져옴

  // Drag and Drop states
  const [isDraggingMain, setIsDraggingMain] = useState(false);
  const [isDraggingAdditional, setIsDraggingAdditional] = useState(false);

  // Existing image URLs for edit mode
  const [existingMainImageUrl, setExistingMainImageUrl] = useState<string>(initialData?.image || '');
  const [existingAdditionalImageUrls, setExistingAdditionalImageUrls] = useState<string[]>(initialData?.additionalImages || []);
  const [removedAdditionalImageUrls, setRemovedAdditionalImageUrls] = useState<string[]>([]);

  const { uid } = useAuth();
  // useAccessibleLorebooks hook 사용
  const { lorebookEntries, loading: lorebooksLoading, error: lorebookError } = useAccessibleLorebooks(uid);

  // Default emotion suggestions
  const DEFAULT_EMOTION_SET = useMemo(() => ['행복','슬픔','분노','사랑','중립'], []);

  useEffect(() => {
    const initialTags = initialData?.tags || [];
    setCurrentTags(Array.from(new Set([...initialTagSuggestions, ...initialTags])));
    // 로어북 로딩 useEffect 제거 (hook이 처리)
  }, [initialData]); // uid 의존성 제거 (hook이 처리)

  // 로어북 데이터를 MultiSelect 형식으로 변환 (useMemo 사용)
  const lorebookOptions = useMemo(() => {
    return lorebookEntries.map((entry: LorebookEntry) => ({
      value: entry.id,
      label: entry.title,
    }));
  }, [lorebookEntries]);

  const form = useForm<CharacterFormValues>({
    initialValues: {
      name: initialData?.name || '',
      description: initialData?.description || '',
      mainImage: null,
      additionalImages: [],
      detail: initialData?.detail || '',
      firstMessage: initialData?.firstMessage || '',
      tags: initialData?.tags || [],
      isPublic: initialData?.isPublic ?? true,
      isNSFW: initialData?.isNSFW || false,
      isBanmal: initialData?.isBanmal || false,
      lorebookIds: initialData?.lorebookIds || [],
      requiredImageTags: initialData?.requiredImageTags || '',
      // 포인트 시스템 필드 초기값
      isPremiumChat: initialData?.isPremiumChat || false,
      chatPointCost: initialData?.chatPointCost || 0, // 기본값 0 또는 POINT_CONSUMPTION_RATES.chatPremium 등

      // 추가 이미지 갤러리 메타 기본값
      additionalImageTags: {},
      additionalImageWeights: {},

      // 커스텀 감정 초기값 (초기 데이터에 없으면 빈 배열)
      customEmotions: ((initialData as any)?.customEmotions as string[] | undefined) || [],
    },
    validate: {
      name: (value) => (value.trim().length > 0 ? null : '캐릭터 이름을 입력해주세요'),
      description: (value) => (value.trim().length > 0 ? null : '간단한 소개를 입력해주세요'),
      mainImage: (value, values) => (mode === 'create' && !values.mainImage && !tempMainImageFile && !mainImagePreview) || (mode === 'edit' && !existingMainImageUrl && !values.mainImage && !tempMainImageFile && !mainImagePreview) ? '대표 이미지를 업로드해주세요' : null,
      detail: (value) => {
        const byteCount = new Blob([value]).size;
        return byteCount <= 10000 ? null : '상세 설정은 10,000 바이트를 초과할 수 없습니다';
      },
      firstMessage: (value) => {
        const byteCount = new Blob([value]).size;
        return byteCount <= 1500 ? null : '첫 메시지는 1,500 바이트를 초과할 수 없습니다';
      },
      chatPointCost: (value, values) => (values.isPremiumChat && (value === undefined || value <= 0) ? '유료 채팅 비용은 0보다 커야 합니다.' : null),
    },
  });

  useEffect(() => {
    const detailBytes = new Blob([form.values.detail]).size;
    setDetailLength(detailBytes);
    const firstMessageBytes = new Blob([form.values.firstMessage]).size;
    setFirstMessageLength(firstMessageBytes);
  }, [form.values.detail, form.values.firstMessage]);


  // Effect to set initial gallery values when data is loaded in edit mode
  useEffect(() => {
    if (mode === 'edit' && initialData?.additionalImages && initialGalleryData) {
      const tags: Record<number, string[]> = {};
      const weights: Record<number, number> = {};

      const galleryMap = new Map(initialGalleryData.items.map(item => [item.url, item]));

      initialData.additionalImages.forEach((imageUrl, index) => {
        const galleryItem = galleryMap.get(imageUrl);
        if (galleryItem) {
          tags[index] = galleryItem.tags || [];
          weights[index] = galleryItem.weight ?? 1;
        }
      });
      
      form.setFieldValue('additionalImageTags', tags);
      form.setFieldValue('additionalImageWeights', weights);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData, initialGalleryData, mode]);

  // --- Image Handling Logic ---

  // 1. Main Image Handling
  const handleMainImageChange = (file: File | null) => {
    if (file && file.type.startsWith('image/')) { // Basic type check
      setTempMainImageFile(file); // Store the selected file temporarily
      setShowMainImageOptions(true); // Show crop/original buttons
      form.setFieldValue('mainImage', null); // Clear the form value until confirmed
      setMainImagePreview(URL.createObjectURL(file)); // Show temporary preview
    } else if (file) {
        notifications.show({ title: '오류', message: '이미지 파일만 업로드 가능합니다.', color: 'orange' });
    } else {
      // Clear temporary file and options if selection is cancelled
      setTempMainImageFile(null);
      setShowMainImageOptions(false);
      form.setFieldValue('mainImage', null);
      // Restore existing preview in edit mode if available
      setMainImagePreview(existingMainImageUrl || null);
    }
  };

  const handleCropMainImageClick = () => {
    if (tempMainImageFile) {
      setSelectedImageFile(tempMainImageFile);
      setIsCroppingMainImage(true);
      setCropModalOpen(true);
      setShowMainImageOptions(false); // Hide options after choice
    }
  };

  const handleUseOriginalMainImageClick = () => {
    if (tempMainImageFile) {
      form.setFieldValue('mainImage', tempMainImageFile); // Set the original file in the form
      setMainImagePreview(URL.createObjectURL(tempMainImageFile)); // Keep the preview
      if (mode === 'edit') {
        setExistingMainImageUrl(''); // Clear existing URL if new original is chosen
      }
      setTempMainImageFile(null); // Clear temporary file
      setShowMainImageOptions(false); // Hide options
    }
  };

  // Image Paste Handler
  const handlePasteImage = (event: ClipboardEvent<HTMLDivElement>) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          console.log("Pasted image detected, setting as main image.");
          handleMainImageChange(blob);
          event.preventDefault(); // Prevent default paste behavior
          break; // Handle only the first image found
        }
      }
    }
  };

  // Drag and Drop Handlers - Main Image
  const handleDragOverMain = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingMain(true);
  };

  const handleDragLeaveMain = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingMain(false);
  };

  const handleDropMain = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingMain(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      handleMainImageChange(event.dataTransfer.files[0]);
      event.dataTransfer.clearData();
    }
  };

  // 2. Additional Image Handling
  const handleAdditionalImageChange = (file: File | null) => {
     if (file && file.type.startsWith('image/')) { // Basic type check
      setTempAdditionalImageFile(file); // Store temporarily
      setShowAdditionalImageOptions(true); // Show options
    } else if (file) {
        notifications.show({ title: '오류', message: '이미지 파일만 업로드 가능합니다.', color: 'orange' });
    } else {
      setTempAdditionalImageFile(null);
      setShowAdditionalImageOptions(false);
    }
  };

  const handleCropAdditionalImageClick = () => {
    if (tempAdditionalImageFile) {
      setSelectedImageFile(tempAdditionalImageFile);
      setIsCroppingMainImage(false); // Indicate cropping for additional image
      setCropModalOpen(true);
      setShowAdditionalImageOptions(false);
    }
  };

  const handleUseOriginalAdditionalImageClick = () => {
    if (tempAdditionalImageFile) {
      // Add the original file directly
      const currentFiles = [...form.values.additionalImages];
      currentFiles.push(tempAdditionalImageFile);
      form.setFieldValue('additionalImages', currentFiles);

      // Add preview
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target && e.target.result) {
          setAdditionalImagePreviews([...additionalImagePreviews, e.target.result as string]);
        }
      };
      reader.readAsDataURL(tempAdditionalImageFile);

      setTempAdditionalImageFile(null); // Clear temporary file
      setShowAdditionalImageOptions(false); // Hide options
    }
  };

   // Drag and Drop Handlers - Additional Images
   const handleDragOverAdditional = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAdditional(true);
  };

  const handleDragLeaveAdditional = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAdditional(false);
  };

  const handleDropAdditional = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingAdditional(false);
    if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
      // Handle multiple dropped files if needed, or just the first one
      handleAdditionalImageChange(event.dataTransfer.files[0]);
      event.dataTransfer.clearData();
    }
  };


  // 3. Cropping Completion
  const handleCroppedImage = (croppedImageDataUrl: string) => {
    const fileName = selectedImageFile?.name || `cropped-image-${Date.now()}.jpg`;
    dataUrlToFile(croppedImageDataUrl, fileName)
      .then(file => {
        if (isCroppingMainImage) {
          form.setFieldValue('mainImage', file);
          setMainImagePreview(croppedImageDataUrl);
          if (mode === 'edit') {
            setExistingMainImageUrl(''); // Clear existing URL if cropped
          }
          setTempMainImageFile(null); // Clear temp file if cropping was chosen
        } else {
          // Handle cropped additional image
          const currentFiles = [...form.values.additionalImages];
          currentFiles.push(file);
          form.setFieldValue('additionalImages', currentFiles);
          setAdditionalImagePreviews([...additionalImagePreviews, croppedImageDataUrl]);
          setTempAdditionalImageFile(null); // Clear temp file
        }
        setCropModalOpen(false);
        setSelectedImageFile(null);
      })
      .catch(error => {
          console.error("Error converting data URL to file:", error);
          notifications.show({ title: '오류', message: '이미지 처리 중 오류 발생', color: 'red' });
          setCropModalOpen(false);
          setSelectedImageFile(null);
          // Reset options visibility if needed
          if (isCroppingMainImage) setShowMainImageOptions(false);
          else setShowAdditionalImageOptions(false);
      });
  };

  // 4. Removing Additional Image
  const removeAdditionalImage = (index: number) => {
    const newPreviews = [...additionalImagePreviews];
    const removedPreview = newPreviews.splice(index, 1)[0];
    setAdditionalImagePreviews(newPreviews);

    const existingIndex = existingAdditionalImageUrls.indexOf(removedPreview);
    if (existingIndex !== -1) {
      // Remove from existing URLs
      const newExistingUrls = [...existingAdditionalImageUrls];
      newExistingUrls.splice(existingIndex, 1);
      setExistingAdditionalImageUrls(newExistingUrls);
      // Add to removed URLs if it was an existing one
      setRemovedAdditionalImageUrls([...removedAdditionalImageUrls, removedPreview]);
    } else {
      // Remove from newly added files (adjust index based on remaining existing URLs)
      const newFileIndex = index - existingAdditionalImageUrls.length;
      if (newFileIndex >= 0 && newFileIndex < form.values.additionalImages.length) {
        const newFiles = [...form.values.additionalImages];
        newFiles.splice(newFileIndex, 1);
        form.setFieldValue('additionalImages', newFiles);
      } else {
        console.warn("Could not find matching new file to remove for preview:", removedPreview);
      }
    }
  };


  // --- Stepper and Submission Logic ---

  const nextStep = () => {
    form.validate(); // Validate current step fields
    if (active === 0) {
      if (!form.errors.name && !form.errors.description && !form.errors.mainImage) {
        setActive((current) => current + 1);
      }
    } else if (active === 1) {
      if (!form.errors.detail && !form.errors.firstMessage) {
        setActive((current) => current + 1);
      }
    }
  };

  const prevStep = () => {
    setActive((current) => current - 1);
  };

  const handleGenerateLore = async () => {
    const wc = wikiContent.trim();
    if (!wc) return;
    setIsGeneratingLore(true);
    setGenError(null);
    setGenMeta(null);
    setGenResult(null);
    const reqId = crypto.randomUUID();
    setLastRequestId(reqId);

    try {
      const response = await fetch('/api/generate-lore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wikiContent: wc,
          model: selectedModel,
          characterId: undefined,
          requestId: reqId,
          userId: uid || undefined, // 쿠키에서 uid 가져오기
        }),
      });

      if (!response.ok) {
        let body: any = null;
        try { body = await response.json(); } catch {}
        const status = response.status;
        const code = body?.code;
        const message = body?.message || response.statusText;

        setGenError({ status, code, message, required: body?.required, balance: body?.balance });

        let notifyMsg = message || '';
        switch (status) {
          case 400:
            notifyMsg = '요청이 올바르지 않습니다. 위키 내용과 모델을 확인하세요.';
            break;
          case 401:
            notifyMsg = '로그인이 필요합니다.';
            break;
          case 402:
            notifyMsg = '포인트가 부족합니다. /goods에서 충전하거나 /redeem에서 쿠폰 등록을 진행하세요.';
            break;
          case 502:
            notifyMsg = 'AI 제공자 오류가 발생했습니다. 잠시 후 다시 시도하세요.';
            break;
          case 503:
            notifyMsg = '서버 설정 오류: API Key 미설정.';
            break;
          default:
            notifyMsg = `오류가 발생했습니다. (HTTP ${status})`;
        }
        notifications.show({ title: '로어 생성 실패', message: notifyMsg, color: 'red' });
        return;
      }

      const data = (await response.json()) as GenerateLoreResponse;
      setGenResult({ lore: data.lore, firstMessage: data.firstMessage });
      setGenMeta(data.meta);
      notifications.show({
        title: '로어 생성 완료',
        message: '생성된 결과를 확인하고 반영하세요.',
        color: 'teal',
      });
    } catch (error: any) {
      console.error('Error generating lore:', error);
      setGenError({ message: error?.message || '네트워크 오류' });
      notifications.show({
        title: '로어 생성 실패',
        message: '네트워크 오류 또는 서버 연결 문제',
        color: 'red',
      });
    } finally {
      setIsGeneratingLore(false);
    }
  };

  const handleInternalSubmit = async (values: CharacterFormValues) => {
    const uidFromCookie = uid;
    if (!uidFromCookie) {
        notifications.show({ title: '오류', message: '캐릭터를 생성/수정하려면 로그인이 필요합니다.', color: 'red' });
        return;
    }

    // Merge custom emotions from additional images into values.customEmotions before save
    const collectCustomsFromAdditionalImages = (formVals: CharacterFormValues): string[] => {
      const norm = (s: string) =>
        String(s ?? '')
          .trim()
          .toLocaleLowerCase()
          .replace(/\s+/g, ' ')
          .replace(/^[\s"'“”‘’()[\]{}<>•\-–—]+|[\s"'“”‘’()[\]{}<>•\-–—]+$/g, '');

      const defaultKeys = new Set(DEFAULT_EMOTION_SET.map(norm));
      const map = new Map<string, string>();

      // Seed with existing customEmotions to preserve original labels first
      const base = Array.isArray(formVals.customEmotions) ? formVals.customEmotions : [];
      for (const label of base) {
        const disp = String(label ?? '').trim();
        const key = norm(disp);
        if (!key) continue;
        if (defaultKeys.has(key)) continue; // exclude defaults from custom set
        if (!map.has(key)) map.set(key, disp);
      }

      // Merge from all additional image tag rows
      const tagRows = formVals.additionalImageTags || {};
      Object.keys(tagRows).forEach((k) => {
        const arr = Array.isArray(tagRows[Number(k)]) ? tagRows[Number(k)] as string[] : [];
        for (const lab of arr) {
          const disp = String(lab ?? '').trim();
          const key = norm(disp);
          if (!key) continue;
          if (defaultKeys.has(key)) continue;
          if (!map.has(key)) map.set(key, disp);
        }
      });

      return Array.from(map.values()).slice(0, 32);
    };

    const mergedCustomEmotions = collectCustomsFromAdditionalImages(values);
    const valuesWithMerged: CharacterFormValues = { ...values, customEmotions: mergedCustomEmotions };

    let finalMainImageUrl = existingMainImageUrl;
    const finalAdditionalImageUrls = [...existingAdditionalImageUrls];

    try {
      // 1. Upload Main Image (if a new File object exists in form)
      if (values.mainImage) {
        finalMainImageUrl = await uploadFileAndGetUrl(values.mainImage, `characters/${uidFromCookie}/`); // 쿠키 uid 사용
      } else if (mode === 'create' && !existingMainImageUrl) {
        // If creating and no image was ever selected (neither existing nor new)
        throw new Error("대표 이미지가 필요합니다.");
      } else if (mode === 'edit' && !existingMainImageUrl && !values.mainImage) {
         // If editing and the existing image was removed AND no new image was selected
         throw new Error("대표 이미지가 필요합니다.");
      }


      // 2. Upload New Additional Images (File objects in form.values.additionalImages)
      // 파일명 힌트: CharacterForm에서 설정한 additionalImageTags를 기반으로 감정명을 파일 이름에 포함
      const baseIndex = existingAdditionalImageUrls.length; // 기존 이미지 개수 이후가 신규 파일의 UI 인덱스
      const uploadPromises = values.additionalImages.map((imageFile, idx) => {
        const uiIndex = baseIndex + idx;
        const tagsForThis = form.values.additionalImageTags?.[uiIndex] || [];
        // 우선순위: 사용자가 지정한 첫 번째 감정 태그 → 없으면 'image'
        const filenameHint = Array.isArray(tagsForThis) && tagsForThis.length > 0 ? tagsForThis[0] : 'image';
        return uploadFileAndGetUrl(imageFile, `character_additional/${uidFromCookie}/`, filenameHint); // 쿠키 uid 사용 + 감정명 힌트
      });
      const uploadedUrls = await Promise.all(uploadPromises);
      finalAdditionalImageUrls.push(...uploadedUrls);

      // 3. Call the onSubmit prop with all values and final URLs
      // The parent component is now responsible for handling the gallery data saving.
      const result = await onSubmit(valuesWithMerged, finalMainImageUrl, finalAdditionalImageUrls);

      // The gallery saving logic is now expected to be handled in the parent component's onSubmit function.
      // This form component's responsibility ends after calling `onSubmit`.
      // We no longer dave gallery data here.

    } catch (error) {
      console.error(`Error during character ${mode}:`, error);
      notifications.show({
        title: '오류 발생',
        message: `캐릭터 ${mode === 'create' ? '생성' : '수정'} 중 오류가 발생했습니다. 다시 시도해주세요.`,
        color: 'red',
      });
    }
  };


  return (
    <Paper withBorder shadow="md" p="xl" radius="md">
      <Stepper active={active} onStepClick={setActive} mb="xl">
        {/* Step 1: Basic Info */}
        <Stepper.Step label="기본 정보" description="이름, 이미지, 소개">
          <Stack>
            <TextInput
              label="캐릭터 이름"
              placeholder="캐릭터의 이름을 입력하세요"
              required
              {...form.getInputProps('name')}
            />

            <Textarea
              label="간단한 소개"
              placeholder="캐릭터에 대한 간단한 소개를 입력하세요"
              required
              minRows={3}
              maxRows={5}
              {...form.getInputProps('description')}
            />

            <MultiSelect
              label="감정 태그"
              placeholder="예: 행복, 설렘, 허탈"
              data={Array.from(
                new Set([
                  ...(form.values.customEmotions || []),
                  ...DEFAULT_EMOTION_SET,
                  ...(emotionSearchValue &&
                  ![...DEFAULT_EMOTION_SET, ...(form.values.customEmotions || [])].includes(emotionSearchValue)
                    ? [emotionSearchValue]
                    : [])
                ])
              ) as string[]}
              searchable
              clearable
              searchValue={emotionSearchValue}
              onSearchChange={setEmotionSearchValue}
              value={form.values.customEmotions}
              onChange={(vals: string[]) =>
                form.setFieldValue('customEmotions', Array.from(new Set(vals)).slice(0, 32))
              }
              onKeyDown={(e) => {
                const input = (e.target as HTMLInputElement).value?.trim();
                if (!input) return;
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  const next = Array.from(new Set([...(form.values.customEmotions || []), input])).slice(0, 32);
                  form.setFieldValue('customEmotions', next);
                  setEmotionSearchValue('');
                }
              }}
            />

            {/* Main Image Input - Added Drag & Drop */}
            <Box
              onPaste={handlePasteImage}
              onDragOver={handleDragOverMain}
              onDragLeave={handleDragLeaveMain}
              onDrop={handleDropMain}
              className={isDraggingMain ? classes.dropzoneActive : classes.dropzone} // Apply dynamic class
            >
              <Group justify="space-between" align="flex-end" mb={5}>
                 <Text size="sm" fw={500}>
                   대표 이미지 <Text span color="red">*</Text>
                 </Text>
                 {/* Show Crop/Original options only when a temp file is selected */}
                 {showMainImageOptions && tempMainImageFile && (
                   <Group gap="xs">
                     <Tooltip label="이미지 크롭하기">
                       <ActionIcon variant="outline" color="blue" onClick={handleCropMainImageClick}>
                         <IconCrop size={16} />
                       </ActionIcon>
                     </Tooltip>
                     <Tooltip label="원본 이미지 사용">
                       <ActionIcon variant="filled" color="teal" onClick={handleUseOriginalMainImageClick}>
                         <IconPhoto size={16} />
                       </ActionIcon>
                     </Tooltip>
                   </Group>
                 )}
              </Group>
              <FileInput
                placeholder="이미지 업로드, 붙여넣기 또는 드래그 앤 드롭" // Updated placeholder
                accept="image/*"
                onChange={handleMainImageChange}
                error={form.errors.mainImage}
                leftSection={<IconUpload size={14} />}
                disabled={showMainImageOptions} // Disable while options are shown
                // Prevent FileInput's own drop handling if we handle it on the Box
                // style={{ pointerEvents: isDraggingMain ? 'none' : 'auto' }}
              />
               <Text size="xs" c="dimmed" ta="center" mt={5}>
                 클릭하여 선택, 붙여넣기(Ctrl+V), 또는 파일을 여기로 드래그하세요.
               </Text>

              {mainImagePreview && (
                <Box mt="md" style={{ position: 'relative', width: 'fit-content', margin: 'auto' }}>
                  <Image
                    src={mainImagePreview}
                    width={200}
                    height={200}
                    alt="Character preview"
                    radius="md"
                    fit="cover"
                  />
                   {/* Re-crop button */}
                   {!showMainImageOptions && (mainImagePreview || existingMainImageUrl) && (
                     <Tooltip label="다시 크롭하기">
                       <ActionIcon
                         size="sm"
                         variant="light"
                         color="blue"
                         style={{ position: 'absolute', top: 5, right: 5, borderRadius: '50%' }}
                         onClick={() => {
                           const fileToCrop = form.values.mainImage;
                           const urlToFetch = !fileToCrop && mainImagePreview && mainImagePreview.startsWith('http') ? mainImagePreview : null;

                           if (fileToCrop) {
                             setSelectedImageFile(fileToCrop);
                             setIsCroppingMainImage(true);
                             setCropModalOpen(true);
                           } else if (urlToFetch) {
                             fetch(urlToFetch)
                               .then(res => res.blob())
                               .then(blob => {
                                 const tempFile = new File([blob], `existing-image-${Date.now()}.jpg`, { type: blob.type });
                                 setSelectedImageFile(tempFile);
                                 setIsCroppingMainImage(true);
                                 setCropModalOpen(true);
                               })
                               .catch(err => {
                                 console.error("Error fetching existing image for re-crop:", err);
                                 notifications.show({ title: '오류', message: '기존 이미지를 불러오는 중 오류 발생', color: 'red' });
                               });
                           } else if (mainImagePreview) {
                               dataUrlToFile(mainImagePreview, `recrop-image-${Date.now()}.jpg`)
                                .then(tempFile => {
                                    setSelectedImageFile(tempFile);
                                    setIsCroppingMainImage(true);
                                    setCropModalOpen(true);
                                })
                                .catch(err => {
                                    console.error("Error converting data URL for re-crop:", err);
                                    notifications.show({ title: '오류', message: '이미지 준비 중 오류 발생', color: 'red' });
                                });
                           }
                         }}
                       >
                         <IconCrop size={14} />
                       </ActionIcon>
                     </Tooltip>
                   )}
                </Box>
              )}
            </Box>

            {/* Additional Images Input - Added Drag & Drop */}
            <Box
              onDragOver={handleDragOverAdditional}
              onDragLeave={handleDragLeaveAdditional}
              onDrop={handleDropAdditional}
              className={isDraggingAdditional ? classes.dropzoneActive : classes.dropzone} // Apply dynamic class
            >
               <Group justify="space-between" align="flex-end" mb={5}>
                 <Text size="sm" fw={500}>
                   추가 이미지 (선택사항)
                 </Text>
                 {/* Show Crop/Original options for additional image */}
                 {showAdditionalImageOptions && tempAdditionalImageFile && (
                   <Group gap="xs">
                     <Tooltip label="이미지 크롭하기">
                       <ActionIcon variant="outline" color="blue" onClick={handleCropAdditionalImageClick}>
                         <IconCrop size={16} />
                       </ActionIcon>
                     </Tooltip>
                     <Tooltip label="원본 이미지 사용">
                       <ActionIcon variant="filled" color="teal" onClick={handleUseOriginalAdditionalImageClick}>
                         <IconPhoto size={16} />
                       </ActionIcon>
                     </Tooltip>
                   </Group>
                 )}
               </Group>
              <FileInput
                placeholder="추가 이미지 업로드 또는 드래그 앤 드롭" // Updated placeholder
                accept="image/*"
                leftSection={<IconUpload size={14} />}
                onChange={handleAdditionalImageChange}
                value={null} // Reset after selection
                disabled={showAdditionalImageOptions} // Disable while options are shown
                 // style={{ pointerEvents: isDraggingAdditional ? 'none' : 'auto' }}
              />
               <Text size="xs" c="dimmed" ta="center" mt={5}>
                 클릭하여 선택 또는 파일을 여기로 드래그하세요.
               </Text>

              {additionalImagePreviews.length > 0 && (
                <Stack mt="md" gap="sm">
                  {additionalImagePreviews.map((preview, index) => (
                    <Group key={preview + '-' + index} align="flex-start" wrap="nowrap">
                      <Box style={{ position: 'relative' }}>
                        <Image
                          src={preview}
                          width={100}
                          height={100}
                          alt={`Additional image ${index + 1}`}
                          radius="md"
                          fit="cover"
                        />
                        <ActionIcon
                          size="xs"
                          color="red"
                          variant="filled"
                          style={{ position: 'absolute', top: 5, right: 5, borderRadius: '50%' }}
                          onClick={() => removeAdditionalImage(index)}
                        >
                          <IconX size={14} />
                        </ActionIcon>
                      </Box>

                      <Stack gap={6} style={{ flex: 1 }}>
                        <MultiSelect
                          label="감정 태그"
                          data={(() => {
                            // 데이터 소스: 기본 정보의 감정 태그(form.values.customEmotions) -> 기본 5개 -> 현재 선택값
                            const baseFromForm: string[] = Array.isArray(form.values.customEmotions) ? form.values.customEmotions : [];
                            const selected: string[] = form.values.additionalImageTags[index] || [];
                            const raw = [...baseFromForm, ...DEFAULT_EMOTION_SET, ...selected];

                            // 정규화/중복 제거:
                            // - label/value 동일 문자열 사용
                            // - normalize(label): trim -> toLocaleLowerCase -> 연속 공백 단일화
                            // - 사용자 표시에는 원형 유지, 비교는 정규화 키 사용
                            // - 현재 선택값이 항상 포함되도록 뒤에서 덮어씀
                            const norm = (t: string) => String(t ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
                            const map = new Map<string, string>();
                            for (const label of raw) {
                              const disp = String(label ?? '').trim();
                              const key = norm(disp);
                              if (!key) continue;
                              map.set(key, disp); // later values (especially selected) override
                            }
                            return Array.from(map.values());
                          })()}
                          placeholder="해당 이미지의 감정을 선택 또는 입력"
                          clearable
                          searchable
                          value={form.values.additionalImageTags[index] || []}
                          onChange={(vals: string[]) =>
                            form.setFieldValue('additionalImageTags', {
                              ...form.values.additionalImageTags,
                              [index]: vals,
                            })
                          }
                          onKeyDown={(e) => {
                            const input = (e.target as HTMLInputElement).value?.trim();
                            if (!input) return;
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              const current = form.values.additionalImageTags[index] || [];
                              if (!current.includes(input)) {
                                form.setFieldValue('additionalImageTags', {
                                  ...form.values.additionalImageTags,
                                  [index]: [...current, input],
                                });
                              }
                            }
                          }}
                          maxDropdownHeight={240}
                        />

                        <NumberInput
                          label="가중치(weight)"
                          min={0}
                          step={1}
                          placeholder="기본 1"
                          value={form.values.additionalImageWeights[index] ?? 1}
                          onChange={(val) =>
                            form.setFieldValue('additionalImageWeights', {
                              ...form.values.additionalImageWeights,
                              [index]: typeof val === 'number' ? val : 1,
                            })
                          }
                        />

                        {/* Firebase URL 표시
                        <Box>
                          <Text size="xs" fw={500} mb={4}>Firebase URL</Text>
                          <Group gap={4} align="center">
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{
                                flex: 1,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {preview}
                            </Text>
                            <CopyButton value={preview} timeout={2000}>
                              {({ copied, copy }) => (
                                <ActionIcon
                                  size="xs"
                                  variant={copied ? 'filled' : 'outline'}
                                  color={copied ? 'teal' : 'gray'}
                                  onClick={copy}
                                >
                                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                </ActionIcon>
                              )}
                            </CopyButton>
                          </Group>
                        </Box> */}
                      </Stack>
                    </Group>
                  ))}
                </Stack>
              )}
            </Box>
          </Stack>
        </Stepper.Step>

        {/* Step 2: Detailed Settings */}
        <Stepper.Step label="상세 설정" description="성격, 배경, 스토리">
          <Stack>
            <Tabs defaultValue="detail">
              <Tabs.List>
                <Tabs.Tab value="detail">캐릭터 상세 설정</Tabs.Tab>
                <Tabs.Tab value="firstMessage">첫 메시지 설정</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="detail" pt="md">
                 {/* Wiki Input (single unified source) */}
                 <Textarea
                   label="위키 내용 붙여넣기 (선택사항)"
                   placeholder="캐릭터 위키 내용을 여기에 붙여넣고 '로어 자동 생성'을 실행하세요."
                   autosize
                   minRows={5}
                   maxRows={15}
                   value={wikiContent}
                   onChange={(event) => setWikiContent(event.currentTarget.value)}
                   mb="sm"
                 />
                 <Group align="end" justify="space-between" mb="sm" wrap="wrap">
                   <Box>
                     <Select
                       label="모델 선택"
                       data={[
                        { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (최신, 포인트 차감)' },
                        { value: 'gemini-2.5-flash-preview-04-17', label: 'LearnLM 2.0 Flash Experimental (무료, 포인트 차감 X)' },
                       ]}
                       value={selectedModel}
                       onChange={(v) => {
                         setSelectedModel(v || 'gemini-2.5-flash-preview-04-17');
                       }}
                       maw={360}
                     />
                     {PAID_MODELS.has(selectedModel) && (
                       <Badge mt={4} color="red" variant="light">유료 모델 - 포인트 차감</Badge>
                     )}
                   </Box>
                   <Button
                     leftSection={<IconWand size={14} />}
                     onClick={handleGenerateLore}
                     loading={isGeneratingLore}
                     disabled={wikiContent.trim().length === 0 || isGeneratingLore}
                   >
                     로어 자동 생성
                   </Button>
                 </Group>

                 {genError && (
                   <Alert color="red" title="로어 생성 실패" icon={<IconAlertTriangle size={16} />} mb="sm">
                     <Text size="sm">
                       {genError.status ? `[${genError.status}${genError.code ? ` ${genError.code}` : ''}] ` : ''}{genError.message || '요청 처리 중 오류가 발생했습니다.'}
                     </Text>
                     {genError.status === 402 && (
                       <Text size="sm" mt={6}>
                         포인트가 부족합니다. <Anchor href="/goods">포인트 충전</Anchor> 또는 <Anchor href="/redeem">쿠폰 등록</Anchor>을 진행해주세요.
                       </Text>
                     )}
                   </Alert>
                 )}

                 {genResult && (
                   <Box>
                     <Divider label="생성 결과" labelPosition="center" my="sm" />
                     {genMeta && (
                       <Text size="xs" c="dimmed" mb="xs">
                         모델: <Code>{genMeta.model}</Code> ·{' '}
                         토큰 합계: <Code>{genMeta.tokens?.total}</Code> ·{' '}
                         청구 포인트: <Code>{genMeta.chargedPoints}</Code> ·{' '}
                         요청 ID: <Code>{genMeta.requestId || lastRequestId}</Code> ·{' '}
                         지연시간: <Code>{genMeta.latencyMs}ms</Code>
                       </Text>
                     )}
                     <Group align="flex-start" grow wrap="wrap">
                       <Box style={{ flex: 1, minWidth: 280 }}>
                         <Textarea
                           label="생성된 상세 설정 (읽기 전용)"
                           value={genResult.lore}
                           readOnly
                           autosize
                           minRows={8}
                         />
                         <Group mt="xs" justify="flex-end">
                           <Button
                             size="xs"
                             variant="light"
                             onClick={() => {
                               if ('detail' in form.values) {
                                 form.setFieldValue('detail', genResult.lore);
                                 notifications.show({ title: '반영됨', message: '상세 설정에 반영했습니다.', color: 'teal' });
                               } else {
                                 notifications.show({ title: '필드 없음', message: '상세 설정 필드를 찾을 수 없습니다.', color: 'yellow' });
                               }
                             }}
                           >
                             상세 설정에 반영
                           </Button>
                         </Group>
                       </Box>
                       <Box style={{ flex: 1, minWidth: 280 }}>
                         <Textarea
                           label="생성된 첫 메시지 (읽기 전용)"
                           value={genResult.firstMessage}
                           readOnly
                           autosize
                           minRows={6}
                         />
                         <Group mt="xs" justify="flex-end">
                           <Button
                             size="xs"
                             variant="light"
                             onClick={() => {
                               if ('firstMessage' in form.values) {
                                 form.setFieldValue('firstMessage', genResult.firstMessage);
                                 notifications.show({ title: '반영됨', message: '첫 메시지에 반영했습니다.', color: 'teal' });
                               } else {
                                 notifications.show({ title: '필드 없음', message: '첫 메시지 필드를 찾을 수 없습니다.', color: 'yellow' });
                               }
                             }}
                           >
                             첫 메시지에 반영
                           </Button>
                         </Group>
                       </Box>
                     </Group>
                   </Box>
                 )}

                 <Divider label="캐릭터 상세 설정" labelPosition="center" my="md" />

                 {/* Detail Textarea with Loading Overlay */}
                 <Box pos="relative">
                   <LoadingOverlay visible={isGeneratingLore} zIndex={1000} overlayProps={{ radius: "sm", blur: 2 }} />
                   <Textarea
                     label={`상세 설정 (${detailLength}/10000 바이트)`}
                     placeholder="캐릭터의 외형, 성격, 배경, 스토리 등 상세 설정을 입력하거나 위키 내용을 붙여넣고 자동 생성 기능을 사용하세요."
                     autosize
                     minRows={10}
                     maxRows={30}
                     {...form.getInputProps('detail')}
                     error={form.errors.detail} // Ensure error is shown
                   />
                   <Text size="xs" c="dimmed" mt={5}>
                     AI가 캐릭터를 이해하는 데 도움이 되는 자세한 정보를 입력하세요. (WW+ 형식 권장)
                   </Text>
                 </Box>
              </Tabs.Panel>

              <Tabs.Panel value="firstMessage" pt="md">
                <Textarea
                  label={`첫 메시지 (${firstMessageLength}/1500 바이트)`}
                  placeholder="채팅 시작 시 캐릭터가 보내는 첫 메시지를 설정하세요"
                  minRows={5}
                  maxRows={8}
                  {...form.getInputProps('firstMessage')}
                  error={form.errors.firstMessage} // Ensure error is shown
                />
                <Text size="xs" c="dimmed" mt={5}>
                  채팅방에 처음 입장했을 때 캐릭터가 보내는 메시지입니다.
                </Text>
              </Tabs.Panel>
            </Tabs>
          </Stack>
        </Stepper.Step>

        {/* Step 3: Other Settings */}
        <Stepper.Step label="기타 설정" description="태그, 공개 여부, NSFW">
          <Stack>
            <MultiSelect
              label="태그"
              placeholder="태그 선택 또는 새 태그 입력"
              data={[
                ...currentTags,
                searchValue && !currentTags.includes(searchValue) && !searchValue.startsWith('새 태그 생성: ')
                  ? `새 태그 생성: "${searchValue}"`
                  : '',
              ].filter(Boolean)}
              searchable
              searchValue={searchValue}
              onSearchChange={setSearchValue}
              onChange={(value) => {
                const newTags = value.filter((tag) => {
                  if (tag.startsWith('새 태그 생성: "')) {
                    const actualTag = tag.match(/새 태그 생성: "(.+)"/)?.[1];
                    if (actualTag && !currentTags.includes(actualTag)) {
                      setCurrentTags((current) => [...current, actualTag]);
                      form.setFieldValue('tags', [...form.values.tags.filter(t => !t.startsWith('새 태그 생성')), actualTag]);
                      setSearchValue('');
                      return false;
                    }
                  }
                  return true;
                });
                form.setFieldValue('tags', newTags.filter(tag => !tag.startsWith('새 태그 생성')));
              }}
              value={form.values.tags}
            />

            {/* 감정 태그 입력은 '기본 정보' 섹션으로 이동되었습니다. */}

            {/* Lorebook Selection */}
            <MultiSelect
              label="로어북 연결 (선택사항)"
              placeholder={lorebooksLoading ? "로어북 로딩 중..." : "연결할 로어북 선택"}
              data={lorebookOptions} // 변환된 데이터 사용
              searchable
              clearable
              disabled={lorebooksLoading || !!lorebookError} // 로딩 중이거나 에러 발생 시 비활성화
              leftSection={<IconBook size={14} />}
              description="캐릭터 설정에 참고할 로어북을 선택합니다. (자신의 로어북 + 공개 로어북)"
              {...form.getInputProps('lorebookIds')}
            />
            {/* 로어북 로딩 에러 표시 */}
            {lorebookError && !lorebooksLoading && (
               <Text c="red" size="xs">로어북 로딩 중 오류 발생: {lorebookError}</Text>
            )}

           {/* 추가: 필수 이미지 태그 입력 필드 */}
           <TextInput
             label="이미지 생성 필수 태그 (선택사항)"
             placeholder="쉼표(,)로 구분하여 입력 (예: 1girl, solo, blue hair)"
             description="캐릭터 이미지 생성 시 항상 포함될 태그를 입력합니다."
             {...form.getInputProps('requiredImageTags')}
           />

           <Divider my="md" />

           <Group>
              <Switch
                label="공개 설정"
                checked={form.values.isPublic}
                onChange={(event) => form.setFieldValue('isPublic', event.currentTarget.checked)}
              />
              <Text size="sm" c="dimmed">
                {form.values.isPublic ? '모든 사용자에게 공개' : '비공개 (나만 볼 수 있음)'}
              </Text>
            </Group>

            <Group>
              <Switch
                label="NSFW (성인 콘텐츠)"
                checked={form.values.isNSFW}
                onChange={(event) => form.setFieldValue('isNSFW', event.currentTarget.checked)}
              />
              {form.values.isNSFW && (
                <Badge color="red">성인 콘텐츠로 표시됩니다</Badge>
              )}
            </Group>

            <Divider my="md" />

            <Group>
              <Switch
                label="반말 사용"
                checked={form.values.isBanmal}
                onChange={(event) => form.setFieldValue('isBanmal', event.currentTarget.checked)}
              />
              <Text size="sm" c="dimmed">
                {form.values.isBanmal ? '캐릭터가 반말을 사용합니다' : '캐릭터가 존댓말을 사용합니다'}
              </Text>
            </Group>

            {form.values.isPremiumChat && (
              <TextInput
                type="number"
                label="메시지당 소모 포인트"
                placeholder="예: 50"
                description="사용자가 메시지를 보낼 때마다 소모될 포인트입니다."
                required={form.values.isPremiumChat}
                min={1} // 최소 1포인트
                {...form.getInputProps('chatPointCost')}
                error={form.errors.chatPointCost}
              />
            )}

          </Stack>
        </Stepper.Step>
      </Stepper>

      {/* Stepper Navigation */}
      <Group justify="space-between" mt="xl">
        {active > 0 ? (
          <Button variant="default" onClick={prevStep}>
            이전
          </Button>
        ) : (
          <div /> // Placeholder
        )}

        {active < 2 ? (
          <Button onClick={nextStep}>
            다음
          </Button>
        ) : (
          <Button onClick={() => form.onSubmit(handleInternalSubmit)()} loading={loading}>
            {mode === 'create' ? '캐릭터 생성하기' : '캐릭터 수정하기'}
          </Button>
        )}
      </Group>

      {/* Image Cropper Modal */}
      <Modal
        opened={cropModalOpen}
        onClose={() => {
            setCropModalOpen(false);
            setSelectedImageFile(null);
            // Reset options visibility if modal is closed without cropping
            if (isCroppingMainImage) setShowMainImageOptions(false);
            else setShowAdditionalImageOptions(false);
        }}
        title="이미지 크롭"
        size="lg"
      >
        {selectedImageFile && (
           <ImageCropper
             imageSrc={URL.createObjectURL(selectedImageFile)} // selectedImageFile is guaranteed non-null here
             onCropComplete={handleCroppedImage}
             onCancel={() => { // Add cancel handler inside cropper as well
                 setCropModalOpen(false);
                 setSelectedImageFile(null);
                 if (isCroppingMainImage) setShowMainImageOptions(false);
                 else setShowAdditionalImageOptions(false);
             }}
           />
        )}
      </Modal>
    </Paper>
  );
}
