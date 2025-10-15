import { NextRequest, NextResponse } from 'next/server';
import { app, db, PATREON_USER_DATA_COLLECTION, POINT_BALANCES_COLLECTION, USERS_COLLECTION } from '@/firebase/config'; // Import Firebase app instance
import { getPointBalanceDocId, POINT_TRANSACTIONS_COLLECTION } from '@/firebase/collections';
import { doc, getDoc, updateDoc, increment, collection, query, where, getDocs, documentId, runTransaction, Timestamp, writeBatch } from 'firebase/firestore'; // documentId, runTransaction, Timestamp, writeBatch 추가
import {
  GenerationConfig,
  getGenerativeModel,
  getVertexAI,
  HarmBlockThreshold,
  HarmCategory,
  SafetySetting,
  SchemaType,
} from 'firebase/vertexai'; // Use firebase/vertexai
import { GoogleGenerativeAI as GoogleAIStudioGenerativeAI, HarmCategory as GoogleAIStudioHarmCategory, HarmBlockThreshold as GoogleAIStudioHarmBlockThreshold } from '@google/generative-ai'; // Import Google AI Studio SDK and alias
import { getTokenCount } from 'gemini-token-estimator'
import { PatreonUserData } from '@/types/patreon';
import { PointBalance, PointTransaction, PointTransactionType, TIER_BENEFITS } from '@/types/point';
import { characterFromDoc } from '@/utils/firestoreUtils';
import { getUserRoles } from '@/utils/access/roles';
import { assertCharacterReadable, assertCharacterWritable, CHAR_DELETED_WRITE_BLOCKED } from '@/utils/access/visibility';
import { getFirstGoogleAiStudioApiKey } from '@/utils/env';

let thinkingTokenCount = 0; // Thinking tokens are not used in this context, but kept for consistency
let promptTokenCount = 0; // 프롬프트 토큰 수
let candidatesTokenCount = 0; // 후보 토큰 수

// --- BYOK helpers ---
type Provider = 'google' | 'openrouter';

/**
 * Map model name to provider family.
 * google => Gemini/Vertex (gemini-*, learnlm-*)
 * openrouter => Anthropics/OpenAI via OpenRouter (anthropic/*, openai/*)
 */
function resolveProviderForModel(name: string | undefined | null): Provider {
  const n = String(name || '').toLowerCase();
  if (n.startsWith('gemini') || n.startsWith('learnlm')) return 'google';
  if (n.startsWith('anthropic/') || n.startsWith('openai/')) return 'openrouter';
  // default to google family for safety
  return 'google';
}

/**
 * Server-side BYOK check:
 * - settings.useUserApiKeys must be true
 * - provider-specific user key must exist (no value returned; never log keys)
 *   google     -> users/{uid}.apiKeys.googleAiStudio or .google
 *   openrouter -> users/{uid}.apiKeys.openRouter
 * Any failure => false
 */
async function isByokEnabledForUserAndProvider(userId: string, provider: Provider): Promise<boolean> {
  try {
    const uref = doc(db, 'users', userId);
    const usnap = await getDoc(uref);
    if (!usnap.exists()) return false;
    const udata = usnap.data() as any;
    const useUserApiKeys = Boolean(udata?.settings?.useUserApiKeys);
    if (!useUserApiKeys) return false;

    if (provider === 'google') {
      return Boolean(udata?.apiKeys?.googleAiStudio || udata?.apiKeys?.google);
    }
    if (provider === 'openrouter') {
      return Boolean(udata?.apiKeys?.openRouter);
    }
    return false;
  } catch (e) {
    console.error('[generate-lore] BYOK check failed (treated as disabled):', e);
    return false;
  }
}
// --- End BYOK helpers ---

// WW+ 로어 포맷 및 첫 메시지 생성 프롬프트
const generationPrompt = `
You are an expert in creating character descriptions and introductory messages based on provided wiki content.
Generate two pieces of information based on the provided wiki content:
1. A character description in the WW+ format.
2. A first message (greeting) for the character in Korean, reflecting their personality and tone described in the wiki.

**Instructions for WW+ Lore ("lore" field):**
- Extract the character's name for the "name" field.
- Descriptors are enclosed in escaped quotation marks (\\").
- Multiple descriptors for a tag are separated by "+".
- Mind & Personality: Extract 5-10 relevant descriptors each.
- Body: Extract 5-10 descriptors (include height, build, specific parts).
- Clothes: Extract 5-10 descriptors (specific clothing items).
- Likes & Hates: Extract 6-8 descriptors each.
- Attributes: Extract 6-8 descriptors (physical details like hair/eye color, smell, unique features. No personality traits).
- Species, Sex, Sexuality, Age: Extract 1 descriptor each if mentioned. Use "Unknown" if not mentioned.
- Description: Create a concise summary derived from the wiki content.
- Ensure the final lore string strictly adheres to the WW+ format structure.

**Instructions for First Message ("firstMessage" field):**
- Generate a natural-sounding first message (greeting) in **Korean**.
- The message should reflect the character's personality, tone (e.g., formal, informal, cheerful, grumpy), and background as described in the wiki content.
- Keep the message relatively concise, suitable for an initial interaction.

Now, generate the JSON output based on the following wiki content:`;

// Vertex AI 설정 (기존과 동일)
const generationConfig: GenerationConfig = {
  temperature: 1.0,
  topP: 0.90,
  maxOutputTokens: 50000,
};

const safetySettings = [
  { category: GoogleAIStudioHarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: GoogleAIStudioHarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: GoogleAIStudioHarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: GoogleAIStudioHarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// 모델 이름 (기존과 동일)
let modelName = 'gemini-2.5-flash-preview-04-17';

export async function POST(req: NextRequest) {
  try {
    const { wikiContent, userId, requestId, model: modelNameParam, characterId } = await req.json();

    if (modelNameParam) {
      modelName = modelNameParam; // 클라이언트에서 모델 이름을 지정한 경우
    }

    // Block generation for deleted characters (read/write guard)
    try {
      const requesterUid = typeof userId === 'string' ? userId : null;
      const roles = await getUserRoles(requesterUid);
      if (characterId) {
        const snap = await getDoc(doc(db, 'characters', String(characterId)));
        if (snap.exists()) {
          const ch = characterFromDoc(snap as any);
          const isDel = ch?.isDeleted === true;

          try {
            assertCharacterReadable({ requesterUid, roles, character: { isDeleted: isDel } });
          } catch {
            return NextResponse.json({ code: CHAR_DELETED_WRITE_BLOCKED, message: 'Character is deleted' }, { status: 403 });
          }
          try {
            assertCharacterWritable({ requesterUid, roles, character: { isDeleted: isDel } });
          } catch {
            return NextResponse.json({ code: CHAR_DELETED_WRITE_BLOCKED, message: 'Character is deleted' }, { status: 403 });
          }
        }
      }
    } catch (e) {
      // Non-fatal: if character cannot be verified, proceed
    }

    if (!wikiContent) {
      return NextResponse.json({ error: 'Wiki content is required' }, { status: 400 });
    }

    const originalModelName = modelName;
    if (modelName === 'gemini-2.5-flash-preview-04-17') {
      modelName = 'learnlm-2.0-flash-experimental';
    }

    // Determine provider and BYOK (user-billed) status early
    const provider: Provider = resolveProviderForModel(modelName);
    const isUserBilled = userId ? await isByokEnabledForUserAndProvider(userId, provider) : false;
    if (isUserBilled && userId) {
      console.info(`[generate-lore] BYOK active for user ${userId} (provider=${provider}). Skipping point checks and deductions.`);
    }

    // --- Pre-Request Point Check Logic ---
    if (!isUserBilled && userId && (modelName === 'gemini-2.5-pro' || modelName === 'anthropic/claude-sonnet-4.5')) {
      let calculatedPromptTokenCount = 0;
      try {
        // 프롬프트 내용을 합쳐서 토큰 계산
        const fullPromptText = wikiContent;
        // encode 후 length를 사용하여 토큰 수 계산 (await 제거, 라이브러리 API에 따라 동기일 수 있음)
        // 옵션 인자를 제거하고 가장 기본적인 형태로 호출
        const encodedTokens = getTokenCount(fullPromptText) / 2;
        calculatedPromptTokenCount = encodedTokens;
        console.log(`Calculated prompt tokens for pre-check: ${calculatedPromptTokenCount}`);
      } catch (tokenError) {
        console.error('Error calculating tokens for pre-check:', tokenError);
        // 토큰 계산 실패 시 요청을 막을지, 아니면 일단 진행하고 기존 로직에 맡길지 결정 필요
        // 여기서는 일단 오류로 처리하고 요청 중단
        return NextResponse.json(
          { error: '토큰 계산 중 오류가 발생하여 요청을 처리할 수 없습니다.', details: tokenError instanceof Error ? tokenError.message : String(tokenError) },
          { status: 500 }
        );
      }
 
      if (calculatedPromptTokenCount > 0) {
        try {
          await runTransaction(db, async (transaction) => {
            console.log(`Starting pre-request point check transaction for user ${userId}, model ${modelName}.`);
            const patreonDataRef = doc(db, PATREON_USER_DATA_COLLECTION(userId), 'data');
            const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(userId));
 
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
            console.log(`User ${userId} current balance for pre-check: ${currentBalance}`);
 
            const pointsForInput = calculatedPromptTokenCount; // 프롬프트 토큰만으로 계산
            // 응답 토큰은 예측 불가능하므로, 여기서는 프롬프트 토큰 비용만 확인
            // 또는 최소한의 응답 토큰 (예: 1)을 가정하여 차감할 수도 있음
            // 여기서는 프롬프트 토큰 비용만으로 확인
            const totalPointsToDeductForPrompt = pointsForInput;
            console.log(`User ${userId} - Initial points to check for prompt: ${totalPointsToDeductForPrompt}`);
 
            let discountRate = 0;
            if (userPatreonData && userPatreonData.tierId) {
              const tierBenefit = TIER_BENEFITS[userPatreonData.tierId];
              if (tierBenefit && tierBenefit.chatPointDiscountRate) {
                discountRate = tierBenefit.chatPointDiscountRate;
              }
            }
            console.log(`User ${userId} - Discount rate for pre-check: ${discountRate * 100}% (Tier: ${userPatreonData?.tierId || 'N/A'})`);
 
            const actualPointsToDeductForPrompt = Math.max(0, Math.round(totalPointsToDeductForPrompt * (1 - discountRate)));
            console.log(`User ${userId} - Actual points to check for prompt after discount: ${actualPointsToDeductForPrompt}`);
 
            if (currentBalance < actualPointsToDeductForPrompt) {
              console.error(`User ${userId} - Not enough points for prompt. Balance: ${currentBalance}, Needed for prompt: ${actualPointsToDeductForPrompt}`);
              // 여기서 에러를 발생시켜 트랜잭션을 롤백하고, 바깥에서 잡아서 402 응답
              throw new Error('Not enough points for prompt');
            }
            console.log(`User ${userId} has enough points for the prompt. Proceeding with API call.`);
          });
        } catch (error: any) {
          console.error(`Pre-request point check transaction failed for user ${userId} with model ${modelName}:`, error);
          if (error.message === 'Not enough points for prompt') {
            return NextResponse.json(
              { error: '요청을 보내기 위한 포인트가 부족합니다. 프롬프트 토큰 비용을 충당할 수 없습니다.' },
              { status: 402 } // Payment Required
            );
          }
          // 다른 트랜잭션 오류 (DB 오류 등)
          return NextResponse.json(
            { error: '사전 포인트 확인 중 오류가 발생했습니다.', details: error.message },
            { status: 500 }
          );
        }
      }
    }
    // --- End Pre-Request Point Check Logic ---


    // Vertex AI 초기화 (유저 키 우선)
    let usedPersonalApi = false;
    let googleKey = getFirstGoogleAiStudioApiKey();
    try {
      if (userId) {
        const uref = doc(db, 'users', userId);
        const usnap = await getDoc(uref);
        if (usnap.exists()) {
          const udata = usnap.data() as any;
          if (udata?.settings?.useUserApiKeys && (udata?.apiKeys?.googleAiStudio || udata?.apiKeys?.google)) {
            googleKey = udata.apiKeys.googleAiStudio || udata.apiKeys.google;
            usedPersonalApi = true;
          }
        }
      }
    } catch (e) {
      console.error('Failed to load user API key for lore generation:', e);
    }
    if (!googleKey) {
      console.error('Google AI Studio API key is missing for lore generation.');
      return NextResponse.json(
        { error: 'Google AI Studio API key is not configured.' },
        { status: 500 }
      );
    }
    const genAIStudio = new GoogleAIStudioGenerativeAI(googleKey);

    const model = genAIStudio.getGenerativeModel({
      model: modelName,
      generationConfig: {
        ...generationConfig,
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          required: ['lore', 'firstMessage'],
          properties: {
            lore: { type: SchemaType.STRING },
            firstMessage: { type: SchemaType.STRING },
          },
        },
      },
      safetySettings,
    });

    const fullPrompt = `${generationPrompt}\n\n${wikiContent}`;

    // Vertex AI API 호출
    console.log(`Sending prompt to Vertex AI (${modelName}) for lore and first message...`);
    const result = await model.generateContent({
      systemInstruction: fullPrompt,
      contents: [
        { 
          role: 'user',
          parts: [
            {
              text: "test instruction",
            },
          ],
        },
        { 
          role: 'model',
          parts: [
            {
              text: `\`\`\`json  
                {\"lore\": \"[character(\\\"name\\\") { Mind(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Personality(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Body(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Likes(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Hates(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Attributes(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...) Clothes(\\\"descriptor1\\\" + \\\"descriptor2\\\" + ...)]\",\"firstMessage\": \"캐릭터의 성격과 말투를 반영한 한국어 첫 메시지 (인삿말)\"}
                \`\`\``,
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              text: wikiContent,
            },
          ],
        }
      ],
      generationConfig: {
        ...generationConfig,
        responseMimeType: "application/json" ,
        responseSchema: {        
          type: SchemaType .OBJECT,
          required: ['lore', 'firstMessage'],
          properties: {
            lore: {
              type: SchemaType.STRING,
            },
            firstMessage: {
              type: SchemaType.STRING,
            },
          },
        },      
      },
    });
    const response = await result.response;
    const responseText = response.text();
    console.log("Received raw response from Vertex AI:", responseText);

    const usageMetadata = response.usageMetadata;
    promptTokenCount = usageMetadata?.promptTokenCount  || 0; // 프롬프트 토큰 수
    thinkingTokenCount = (usageMetadata as any).thinkingTokenCount || 0; // 생각 토큰 수
    candidatesTokenCount = usageMetadata?.candidatesTokenCount || 0; // 후보 토큰 수
    console.log(`Prompt tokens: ${promptTokenCount}, Thinking tokens: ${thinkingTokenCount}, Candidates tokens: ${candidatesTokenCount}`);

    // 응답 내용에서 텍스트 추출 및 JSON 객체 파싱
    let generatedData: { lore?: string; firstMessage?: string } = {};
    let responseTextString = '';

    if (responseText) {
        // Concatenate all text parts
        responseTextString = responseText
    } else {
        console.error("Invalid or empty responseText structure:", responseText);
        return NextResponse.json({ error: 'Invalid response structure from AI.' }, { status: 500 });
    }

    try {
        // Try to extract JSON object from the text string
        const jsonStartIndex = responseTextString.lastIndexOf('{', responseTextString.lastIndexOf('"lore": "[character'));
        const jsonEndIndex = responseTextString.lastIndexOf('}');

        if (jsonStartIndex !== -1 && jsonEndIndex !== -1 && jsonEndIndex > jsonStartIndex) {
            const jsonString = responseTextString.substring(jsonStartIndex, jsonEndIndex + 1);
            generatedData = JSON.parse(jsonString);
            console.log("Successfully extracted and parsed JSON object from response text.");
        } else {
            console.error("Could not find a valid JSON object in the response text string.");
            // Fallback: Try to extract JSON block if direct extraction fails
            const jsonMatch = responseTextString.match(/```json\s*([\s\S]*?)\s*```/);
            if (jsonMatch && jsonMatch[1]) {
                try {
                    generatedData = JSON.parse(jsonMatch[1]);
                    console.log("Successfully extracted and parsed JSON block from response text string.");
                } catch (fallbackParseError) {
                    console.error("Failed to parse extracted JSON block:", fallbackParseError);
                    return NextResponse.json({ error: 'Failed to process AI response format.' }, { status: 500 });
                }
            } else {
                 return NextResponse.json({ error: 'Failed to extract valid JSON from AI response text string.' }, { status: 500 });
            }
        }
    } catch (parseError) {
        console.error("Failed to parse extracted JSON:", parseError);
        return NextResponse.json({ error: 'Failed to process AI response format.' }, { status: 500 });
    }


    const { lore, firstMessage } = generatedData;

    // 생성된 로어 및 첫 메시지 형식 검증
    if (!lore || !lore.trim().startsWith('[character')) {
        console.error('Invalid lore format generated:', lore);
        // 첫 메시지만이라도 반환할지, 아니면 둘 다 실패 처리할지 결정
        // 여기서는 둘 다 실패 처리
        return NextResponse.json({ error: 'Failed to generate lore in the expected format.' }, { status: 500 });
    }
     if (!firstMessage || typeof firstMessage !== 'string' || firstMessage.trim().length === 0) {
        console.error('Invalid or empty first message generated:', firstMessage);
        // 로어만이라도 반환할지 결정
        // 여기서는 둘 다 실패 처리
        return NextResponse.json({ error: 'Failed to generate a valid first message.' }, { status: 500 });
    }


    console.log("Generated Lore:", lore);
    console.log("Generated First Message:", firstMessage);

    // --- Point Deduction Logic (Uses API reported tokens) ---
    // 차감 대상 모델: gemini-2.5-pro-exp-03-25
    // gemini-2.5-pro-exp-03-25 모델은 차감 없음
    console.log(`Point deduction check: UserID: ${userId}, Model: ${modelName}, API PromptTokens: ${promptTokenCount}, API CandidateTokens: ${candidatesTokenCount}`);
 
    if (!isUserBilled && userId && (modelName === 'gemini-2.5-pro' || modelName === 'anthropic/claude-sonnet-4.5')) {
      // API가 0 토큰을 반환하는 경우 (예: 오류 또는 매우 짧은 응답)에 대한 처리
      if (promptTokenCount === 0 && candidatesTokenCount === 0) {
        console.warn(`Skipping point deduction for user ${userId} with model ${modelName} due to zero token counts from API. This might indicate an issue with token reporting or a fallback scenario where tokens are not available.`);
      } else {
        try {
          await runTransaction(db, async (transaction) => {
            console.log(`Starting point deduction transaction for user ${userId}, model ${modelName} using API tokens.`);
            const userRef = doc(db, USERS_COLLECTION, userId); // userRef는 현재 사용되지 않지만, 필요시 활용 가능
            const patreonDataRef = doc(db, PATREON_USER_DATA_COLLECTION(userId), 'data');
            const pointBalanceRef = doc(db, POINT_BALANCES_COLLECTION, getPointBalanceDocId(userId));

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
            const pointsForInput = promptTokenCount;
            const pointsForOutput = candidatesTokenCount;
            const totalPointsToDeduct = pointsForInput + pointsForOutput + thinkingTokenCount;
            console.log(`User ${userId} - Initial points to deduct (Input: ${pointsForInput}, Output: ${pointsForOutput}, Thinking: ${thinkingTokenCount}): ${totalPointsToDeduct}`);

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
            const descriptionModelLabel = usedPersonalApi ? 'Personal Language Model' : modelName;
            const newTransaction: PointTransaction = {
              id: transactionId,
              userId,
              type: 'chat_usage' as PointTransactionType,
              amount: -actualPointsToDeduct,
              description: `Generated lore and first message using ${descriptionModelLabel}`,
              transactionDate: Timestamp.now().toDate(),
              relatedId: '',
            };
            transaction.set(pointTransactionRef, newTransaction);

            console.log(`Point deduction successful for user ${userId}. Model: ${modelName}. Deducted: ${actualPointsToDeduct}, New Balance: ${newBalance}`);
          });
        } catch (error: any) { // This catch is for the runTransaction
          console.error(`Point deduction transaction failed for user ${userId} with model ${modelName}:`, error);
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
      } // End of 'else' for (promptTokenCount === 0 && candidatesTokenCount === 0)
    } else if (!isUserBilled && userId && modelName === 'gemini-2.5-flash-preview-04-17') {
      console.log(`Point deduction skipped for user ${userId} as model is ${modelName}.`);
    }

    return NextResponse.json({ lore: lore.trim(), firstMessage: firstMessage.trim() }); // 로어와 첫 메시지 반환

  } catch (error) {
    console.error('Error generating lore and first message via Vertex AI:', error);
    return NextResponse.json({ error: 'Failed to generate content due to an internal server error.' }, { status: 500 });
  }
}
