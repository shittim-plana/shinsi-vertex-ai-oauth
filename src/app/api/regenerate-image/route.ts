'use server';

import { NextRequest, NextResponse } from 'next/server';
import { Character } from '@/types/character'; // Character 타입은 직접 사용되지 않으므로 제거 가능
import { db, PATREON_USER_DATA_COLLECTION, storage, USERS_COLLECTION } from '@/firebase/config'; // app, db는 직접 사용되지 않으므로 제거 가능
import { v4 as uuidv4 } from 'uuid';
import JSZip from 'jszip';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { novelAiQueue } from '@/utils/novelAiQueue';
import { collection, doc, runTransaction, Timestamp } from '@firebase/firestore';
import { getPointBalanceDocId, POINT_BALANCES_COLLECTION, POINT_TRANSACTIONS_COLLECTION } from '@/firebase/collections';
import { PatreonUserData } from '@/types/patreon';
import { PointBalance, PointTransaction, PointTransactionType, TIER_BENEFITS } from '@/types/point';
import { Buffer } from 'buffer';


export async function POST(req: NextRequest) {
  try {
    const {
      // character, // 재성성 시 character 정보는 직접 사용하지 않음
      // userPersona, // 재성성 시 userPersona 정보는 직접 사용하지 않음
      imageGenPrompt, // 사용자가 제공한, 태그 없이 그대로 사용할 프롬프트
      roomId,
      isRoomNSFW, // 캐릭터의 NSFW 설정을 따르도록 클라이언트에서 전달받음
      originalImageUrl, // img2img를 위한 원본 이미지 URL (선택 사항)
      userId, // 사용자 ID는 포인트 차감 및 트랜잭션 기록을 위해 필요
    } = await req.json() as {
      // character: Character | null;
      // userPersona: any;
      imageGenPrompt: string; // 재성성 시에는 이 프롬프트를 직접 사용
      roomId: string;
      isRoomNSFW: boolean;
      originalImageUrl?: string;
      userId?: string; // 포인트 차감 및 트랜잭션 기록을 위해 필요
    };

    if (!imageGenPrompt || typeof imageGenPrompt !== 'string') {
      return NextResponse.json({ error: 'Invalid imageGenPrompt provided.' }, { status: 400 });
    }
    if (!roomId || typeof roomId !== 'string') {
      return NextResponse.json({ error: 'Invalid roomId provided.' }, { status: 400 });
    }

    // 기본 프롬프트 및 네거티브 프롬프트 설정 (기존 로직과 유사하게 유지)
    let basePrompt = "{best quality}, blue archive, official art, 1.0::artist:doremi (doremi4704)::, 1.0::artist:mx2j::, 0.7::artist:yutokamizu::, 0.8::artist:child (isoliya)::, 0.8::artist:soeyumi::, 0.8::artist:hennnachoco::, 0.8::artist:mimitoke::,{year 2025, year 2024}, Detail Shading, no text, best quality, very aesthetic, absurdres, incredibly absurdres, ";
    const negativePromptBase = "logo, emblem, brand mark, copyright, copyright symbol, trademark, {{censored}}, {{{blurry}}},{{{{{{{{worst quality, bad quality, japanese text}}}}}}}}, {{{{bad hands, closed eyes}}}}, {{{bad eyes, bad pupils, bad glabella}}}, {{{undetailed eyes}}}, multiple views, error, extra digit, fewer digits, jpeg artifacts, signature, watermark, username, reference, {{unfinished}}, {{unclear fingertips}}, {{twist}}, {{squiggly}}, {{grumpy}}, {{incomplete}}, {{imperfect fingers}}, disorganized colors, cheesy, {{very displeasing}}, {{mess}}, {{approximate}}, {{sloppiness}},";

    if (isRoomNSFW) { // 클라이언트에서 전달된 isRoomNSFW (캐릭터 기준) 사용
      basePrompt += "nsfw,";
    }

    // Vertex AI를 통한 프롬프트 상세화 과정 생략, imageGenPrompt를 직접 사용
    const detailedPrompt = imageGenPrompt; // 사용자가 제공한 프롬프트를 기본 프롬프트에 추가

    const requestBody: any = { // Use any for flexibility with NovelAI params
      input: detailedPrompt, // VertexAI generated prompt
      model: "nai-diffusion-4-5-full",
      action: originalImageUrl ? "img2img" : "generate", // Change action for regeneration
      parameters: {
        // Common parameters
        params_version: 3,
        width: 1088,
        height: 1088,
        scale: 5,
        sampler: "k_dpmpp_2m_sde",
        steps: 28,
        n_samples: 1,
        ucPreset: 0,
        qualityToggle: true,
        autoSmea: true,
        dynamic_thresholding: false,
        controlnet_strength: 1,
        legacy: false,
        cfg_rescale: 0.5,
        noise_schedule: "karras",
        legacy_v3_extend: false,
        skip_cfg_above_sigma: null,
        use_coords: false,
        legacy_uc: false,
        normalize_reference_strength_multiple: false,
        characterPrompts: [],
        v4_prompt: {
          caption: {
            base_caption: detailedPrompt, // Use the prompt from VertexAI
            char_captions: []
          },
          use_coords: false,
          use_order: true
        },
        v4_negative_prompt: {
          caption: {
            base_caption: negativePromptBase,
            char_captions: []
          },
          legacy_uc: false
        }
      },
    };

    if (originalImageUrl) {
      try {
        const imgRes = await fetch(originalImageUrl);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch original image for img2img: ${imgRes.status}`);
        }
        const imgArrayBuffer = await imgRes.arrayBuffer();
        const imgBase64 = Buffer.from(imgArrayBuffer).toString('base64');
        // NovelAI img2img expects base64 image data, not a URL
        requestBody.parameters.image = imgBase64;
      } catch (e: any) {
        console.error('[Regenerate API] Failed to load/convert originalImageUrl for img2img:', e?.message || e);
        throw new Error('Failed to prepare original image for img2img');
      }

      requestBody.parameters.strength = 0.7;
      requestBody.parameters.noise = 0.1;
      requestBody.parameters.add_original_image = false;
    } else {
      requestBody.parameters.add_original_image = true;
    }

    const MAX_RETRIES = 5;
    let lastError: any = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`Attempt ${attempt} to fetch and process image from NovelAI...`);
        const novelAIResponse = await novelAiQueue.enqueue(requestBody);

        if (!novelAIResponse.ok) {
          const errorText = await novelAIResponse.text();
          console.error(`NovelAI API Error (Attempt ${attempt}, Status ${novelAIResponse.status}): ${errorText}`);
          throw new Error(`NovelAI API request failed with status ${novelAIResponse.status}`);
        }

        const blob = await novelAIResponse.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const zip = await JSZip.loadAsync(arrayBuffer);
        const filesInZip = Object.keys(zip.files);

        if (filesInZip.length === 0) {
          console.error(`Zip file is empty (Attempt ${attempt}).`);
          throw new Error("The zip file is empty.");
        }

        const firstFileName = filesInZip.find(fileName => !zip.files[fileName].dir);
        if (!firstFileName) {
          console.error(`No files found in zip (Attempt ${attempt}).`);
          throw new Error("No files found in the zip file (only directories).");
        }

        const imageFile = zip.file(firstFileName);
        if (!imageFile) {
          console.error(`Could not access first file in zip (Attempt ${attempt}): ${firstFileName}`);
          throw new Error(`Could not access the first file found: ${firstFileName}`);
        }

        const imageBuffer = await imageFile.async('nodebuffer');
        const contentType = 'image/png';
        const fileExtension = 'png';
        const imageFileName = `${uuidv4()}.${fileExtension}`;
        const storageRefPath = `generatedImages/${roomId}/${imageFileName}`;
        const storageRefInstance = ref(storage, storageRefPath);

        await uploadBytes(storageRefInstance, imageBuffer, { contentType: contentType });
        const downloadURL = await getDownloadURL(storageRefInstance);

                // 포인트 차감 10000포인트
        try {
          await runTransaction(db, async (transaction) => {
            console.log(`Starting point deduction transaction for user ${userId}, 10000 tokens.`);
            const patreonDataRef = doc(db, PATREON_USER_DATA_COLLECTION(userId || ''), 'data');
            const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(userId || ''));

            const [patreonDataDoc, pointBalanceDoc] = await Promise.all([
              transaction.get(patreonDataRef),
              transaction.get(pointBalanceRef),
            ]);

            let userPatreonData: PatreonUserData | null = null;
            if (patreonDataDoc.exists()) {
              userPatreonData = patreonDataDoc.data() as PatreonUserData;
            }

            let currentBalance = 0;
            if (pointBalanceDoc.exists()) {
              currentBalance = (pointBalanceDoc.data() as PointBalance).balance;
            }
            console.log(`User ${userId} current balance: ${currentBalance}`);

            // 1포인트 = 1토큰
            const totalPointsToDeduct = 10000;
            console.log(`User ${userId} - Initial points to deduct 10000 tokens.`);

            let discountRate = 0;
            if (userPatreonData && userPatreonData.tierId) {
              const tierBenefit = TIER_BENEFITS[userPatreonData.tierId];
              if (tierBenefit && tierBenefit.chatPointDiscountRate) {
                discountRate = tierBenefit.chatPointDiscountRate;
              }
            }
            console.log(`User ${userId} - Discount rate: ${discountRate * 100}% (Tier: ${userPatreonData?.tierId || 'N/A'})`);

            const actualPointsToDeduct = Math.max(0, Math.round(totalPointsToDeduct * (1 - discountRate)));
            console.log(`User ${userId} - Actual points to deduct after discount: ${actualPointsToDeduct}`);

            if (currentBalance < actualPointsToDeduct) {
              console.error(`User ${userId} - Not enough points. Balance: ${currentBalance}, Needed: ${actualPointsToDeduct}`);
              throw new Error('Not enough points');
            }

            const newBalance = currentBalance - actualPointsToDeduct;
            transaction.set(pointBalanceRef, { userId, balance: newBalance, lastUpdated: Timestamp.now().toDate() }, { merge: true });

            const transactionId = doc(collection(db, POINT_TRANSACTIONS_COLLECTION)).id;
            const pointTransactionRef = doc(db, POINT_TRANSACTIONS_COLLECTION, transactionId);
            const newTransaction: PointTransaction = {
              id: transactionId,
              userId: userId || '',
              type: 'chat_usage' as PointTransactionType,
              amount: -actualPointsToDeduct,
              description: `Generate image using 10000 tokens. Tier: ${userPatreonData?.tierId || 'N/A'}. Discount: ${discountRate * 100}%. Original: ${totalPointsToDeduct}. Deducted: ${actualPointsToDeduct}.`,
              transactionDate: Timestamp.now().toDate(),
              relatedId: 'generate_image', // Optional: related ID for this transaction
            };
            transaction.set(pointTransactionRef, newTransaction);

            console.log(`Point deduction successful for user ${userId}. Deducted: ${actualPointsToDeduct}, New Balance: ${newBalance}`);
          });
        } catch (error: any) { // This catch is for the runTransaction
          console.error(`Point deduction transaction failed for user ${userId}:`, error);
          if (error.message === 'Not enough points') {
            return NextResponse.json( // Return from POST function
              { error: '포인트가 부족합니다. Patreon 후원 또는 다른 방법으로 포인트를 충전해주세요.' },
              { status: 402 }
            );
          }
          return NextResponse.json( // Return from POST function
            { error: '포인트 차감 중 오류가 발생했습니다.', details: error.message },
            { status: 500 }
          );
        }
        // 포인트 차감 성공 후 이미지 URL 반환

        console.log(`Image uploaded to Firebase Storage with Content-Type: ${contentType}`, downloadURL);
        return NextResponse.json({ imageUrl: downloadURL, generatedPrompt: detailedPrompt, imageGenPrompt: detailedPrompt });

      } catch (error: any) {
        lastError = error;
        console.error(`Error during NovelAI fetch or processing (Attempt ${attempt}):`, error.message); // Log error.message for better clarity
        if (attempt < MAX_RETRIES) {
          const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff: 1s, 2s, 4s (for 3 retries)
          console.log(`Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error('[Regenerate API] All attempts to fetch and process image from NovelAI failed.');
    const errorMessage = lastError instanceof Error ? lastError.message : 'Failed to regenerate image after multiple retries.';
    return NextResponse.json({ error: errorMessage }, { status: 500 });

  } catch (error: any) {
    console.error('[Regenerate API] Error in image regeneration process:', error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error.';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}