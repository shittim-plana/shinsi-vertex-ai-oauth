import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, storage } from '@/firebase/config'; // Assuming storage is exported here too
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import {
  GoogleGenerativeAI,
  ModelParams
} from '@google/generative-ai';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'; // Firebase Storage imports
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirstGoogleAiStudioApiKey } from '@/utils/env';

// --- Top-Level Gemini AI Initialization ---
const apiKey = getFirstGoogleAiStudioApiKey();
let genAI: GoogleGenerativeAI | null = null;
let model: ModelParams; // Use appropriate type like GenerativeModel if possible
// const generationConfig: GenerationConfig & {
//   temperature: number;
//   maxOutputTokens: number;
//   responseMimeType: string;
//   history?: { role: string; parts: { text: string }[] }[];
// } = {
//   temperature: 0.1,
//   maxOutputTokens: 200,
//   responseMimeType: "application/json",
//   history: [{
//     role: 'user',
//     parts: [{ text: `
//       캐릭터 이름: 테스트
//       캐릭터 상세 설명: 테스트설명

//       위 캐릭터 설정에 기반하여 다음 정보를 JSON 형식으로 생성해주세요:
//       1. firstMessage: 캐릭터의 첫 대사 (한국어, 50자 내외). 캐릭터의 성격과 설정을 반영해야 합니다.
//       2. isBanmal: 캐릭터가 사용자에게 반말을 사용할지 여부 (true 또는 false). 캐릭터의 성격, 나이, 설정 등을 고려하여 판단해주세요.

//       JSON 형식 예시:
//       {
//         "firstMessage": "안녕하세요! 만나서 반가워요.",
//         "isBanmal": false
//       }
//       `}]
//      },
//     {
//       role: 'model',
//       parts: [{ text: `{
//         "firstMessage": "안녕하세요! 만나서 반가워요.",
//         "isBanmal": false
//       }`},]
//     },
//     {
//       role: 'user',
//       parts: [{ text: `캐릭터 이름: 홍길동
// 캐릭터 상세 설명: 길동이다`}]
//        },
//       {
//         role: 'model',
//         parts: [{ text: `{
//   "firstMessage": "안녕! 만나서 반가워.",
//   "isBanmal": true
// }`},]
//       },
//       {
//         role: 'user',
//         parts: [{ text: `캐릭터 이름: 김철수
//   캐릭터 상세 설명: 그냥 철수다`}]
//          },
//         {
//           role: 'model',
//           parts: [{ text: `{
//     "firstMessage": "안녕하세요! 만나서 반가워요.",
//     "isBanmal": false
//   }`},]
//         }]
// };

if (!apiKey) {
  console.error("CRITICAL: GEMINI_API_KEY is not set. AI features will be disabled.");
} else {
  try {
    genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-preview-04-17" 
      
    });
    console.log("Gemini AI initialized successfully.");
  } catch (error) {
      console.error("Failed to initialize Gemini AI:", error);
      // genAI and model remain null, features requiring them will fail or use defaults
  }
}
// --- End Top-Level Gemini AI Initialization ---


// Increase the body size limit for this route
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '30mb', // Adjust size limit as needed (e.g., '10mb')
    },
  },
};

// Function to generate character details using AI
// Pass model, apiKey, and config as arguments
async function generateCharacterDetails(
  name: string,
  detail: string,
  model: ModelParams, // Corrected type to match top-level 'any' or use GenerativeModel if imported
  apiKey: string | undefined, // Pass apiKey too  
): Promise<{ firstMessage: string; isBanmal: boolean }> {
  // Ensure API key is available before proceeding
  // Note: apiKey check is now also done before calling this function
  if (!apiKey) {
      console.error("Cannot generate AI details: GEMINI_API_KEY is missing.");
      // Return default values or throw a specific error
      return {
          firstMessage: `안녕하세요, 저는 ${name}입니다. 잘 부탁드려요.`, // Default fallback Korean message
          isBanmal: false, // Default fallback
      };
  }

  try {
    const prompt = `
    캐릭터 이름: ${name}
    캐릭터 상세 설명: ${detail}`

    console.log("Sending prompt to Gemini:", prompt); // Log the prompt

    // Ensure the model object passed to the function is valid before calling
    if (!model) {
        console.error("Gemini model is not initialized.");
        throw new Error("AI model not initialized");
    }

    return {
      firstMessage: `안녕하세요, 저는 ${name}입니다. 잘 부탁드려요.`, // Default fallback Korean message
      isBanmal: false, // Default fallback
    };
    // Correctly call generateContent on the passed model
    //const result = await model.generateContent(prompt);

    // --- Safely extract text ---
  } catch (error) {
    console.error("Error generating character details with AI:", error);
    // Fallback to default values on error
    return {
      firstMessage: `안녕하세요, 저는 ${name}입니다. 잘 부탁드려요.`, // Default fallback Korean message
      isBanmal: false, // Default fallback
    };
  }
}


// Define the schema for FormData validation (values are often strings)
const formDataSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  description: z.string().optional(),
  detail: z.string().min(1, { message: 'Detail is required' }),
  // mainImage can be File or string (URL) or undefined - handle separately
  mainImage: z.any().optional(),
  firstMessage: z.string().optional(), // Now optional, can be AI generated
  // Tags might come as a JSON string array
  tags: z.string().optional().default('[]'), // Expect string, parse later
  isPublic: z.string().optional().default('false'), // Expect string 'true' or 'false'
  isNSFW: z.string().optional().default('false'), // Expect string 'true' or 'false'
  isBanmal: z.string().optional(), // Expect string 'true' or 'false', or undefined
});

export async function POST(request: Request) {
  try {
    // Move formData parsing inside the try block
    const formData = await request.formData();
    console.log("Received form data:", formData); // Log the received FormData

    const body = Object.fromEntries(formData.entries());

    console.log("Received form data:", body); // Log the received form data

    // Validate request body
    const validationResult = formDataSchema.safeParse(body);

    if (!validationResult.success) {
      // zod v3/v4: ZodError exposes .issues (not .errors)
      const issues = (validationResult.error as any)?.issues ?? [];
      return NextResponse.json(
        { error: 'Invalid input', details: issues },
        { status: 400 }
      );
    }

    console.log("Validation passed:", validationResult.data); // Log validation result

    // --- Data Extraction and Type Conversion ---
    const {
      name,
      description,
      detail,
      mainImage: mainImageInput, // This can be File | string | null
      firstMessage: firstMessageInput, // string | undefined
      tags: tagsString, // string (JSON array)
      isPublic: isPublicString, // string ('true'/'false')
      isNSFW: isNSFWString, // string ('true'/'false')
      isBanmal: isBanmalString, // string ('true'/'false') | undefined
    } = validationResult.data;

    console.log("Extracted values:", {
      name,
      description,
      detail,
      mainImageInput,
      firstMessageInput,
    }); // Log extracted values

    // Convert types
    let tags: string[];
    try {
      tags = JSON.parse(tagsString || '[]');
      if (!Array.isArray(tags)) throw new Error("Tags must be an array");
    } catch (e: {
      message: string; } | unknown) {
      console.error("Error parsing tags:", e); // Log parsing error
      return NextResponse.json({ error: 'Invalid format for tags (must be a JSON string array)' }, { status: 400 });
    }

    const isPublic = isPublicString === 'true';
    const isNSFW = isNSFWString === 'true';
    // Handle potentially undefined isBanmal string before converting
    const isBanmal: boolean | undefined = isBanmalString === undefined ? undefined : isBanmalString === 'true';
    const firstMessage: string | undefined = firstMessageInput;
    // --- End Data Extraction ---

    // Get creator information from authentication
    // For now, use environment variable as fallback, but ideally get from auth token
    const creatorId = process.env.ADMIN_USER_ID ?? 'default-admin-id';

    // Get creator name from Firebase Auth
    let creatorName = 'Unknown Creator';
    try {
      if (creatorId && creatorId !== 'default-admin-id') {
        const userRecord = await getAuth().getUser(creatorId);
        creatorName = userRecord.displayName || userRecord.email || 'Unknown Creator';
      }
    } catch (error) {
      console.warn('Failed to get creator name from Firebase Auth:', error);
      // Keep default creatorName
    }

    // --- Image Upload Logic ---
    let mainImageUrl: string | null = null;
    // Check if mainImageInput is a File or Blob-like object
    if (typeof mainImageInput === 'object' && mainImageInput !== null && typeof mainImageInput.size === 'number' && mainImageInput.size > 0 && typeof mainImageInput.type === 'string' && typeof mainImageInput.arrayBuffer === 'function') {
      const imageFile = mainImageInput as File; // Treat as File for properties like name
      console.log(`Uploading image file/blob: ${imageFile.name || 'blob'}, Size: ${imageFile.size}, Type: ${imageFile.type}`);
      try {
        // Create a unique path for the image e.g., character-images/userId/timestamp-filename
        // Use a generic name if file name isn't available (might happen with Blobs)
        const fileName = imageFile.name || `image-${Date.now()}`;
        const filePath = `characters/${Date.now()}-${fileName}`; // Use the determined fileName
        const storageRef = ref(storage, filePath);

        // Upload the file (works for both File and Blob)
        const snapshot = await uploadBytes(storageRef, imageFile); // Use imageFile variable
        console.log('Uploaded a blob or file!', snapshot.metadata.fullPath);

        // Get the download URL
        mainImageUrl = await getDownloadURL(snapshot.ref);
        console.log(`Image uploaded successfully: ${mainImageUrl}`);

      } catch (uploadError) {
        console.error("Image upload failed:", uploadError);
        return NextResponse.json({ error: 'Image upload failed' }, { status: 500 });
      }
    } else if (typeof mainImageInput === 'string' && mainImageInput.trim() !== '') {
      mainImageUrl = mainImageInput; // Assume it's a URL if it's a string
      console.log(`Using provided image URL: ${mainImageUrl}`);
    } else {
      console.log("No main image provided or uploaded.");
    }
    // --- End Image Upload ---

    // Apply default description if not provided
    const finalDescription = description ?? name;

    // --- AI Generation Logic ---
    let finalFirstMessage = firstMessage;
    let finalIsBanmal = isBanmal;

    // Generate if either is missing
    if (finalFirstMessage === undefined || finalIsBanmal === undefined) {
      console.log(`AI generation needed for ${name} (firstMessage: ${firstMessage}, isBanmal: ${isBanmal})`);

      // Check if top-level AI components are initialized
      if (!model || !apiKey) {
          console.error("Gemini AI not initialized (missing API key or initialization failed). Skipping AI generation.");
          // Apply defaults directly if AI cannot run
          if (finalFirstMessage === undefined) {
              finalFirstMessage = `안녕하세요, 저는 ${name}입니다. 잘 부탁드려요.`;
          }
          if (finalIsBanmal === undefined) {
              finalIsBanmal = false;
          }
      } else {
          // Proceed with AI generation using top-level variables
          try {
            // Pass the top-level initialized clients/configs
            const aiResult = await generateCharacterDetails(name, detail, model, apiKey);
            // Only override if the original value was undefined
            if (finalFirstMessage === undefined) {
                finalFirstMessage = aiResult.firstMessage;
            }
            if (finalIsBanmal === undefined) {
                finalIsBanmal = aiResult.isBanmal;
            }
            console.log("AI Generation Result:", { firstMessage: finalFirstMessage, isBanmal: finalIsBanmal });
          } catch (aiError) {
            console.error("AI generation failed, using defaults:", aiError);
            // Apply defaults only if still undefined
            if (finalFirstMessage === undefined) {
                finalFirstMessage = `안녕하세요, 저는 ${name}입니다. 잘 부탁드려요.`;
            }
            if (finalIsBanmal === undefined) {
                finalIsBanmal = false;
            }
          }
      } // Close the else block for AI generation
    } else {
        console.log(`Using provided values for ${name}:`, { firstMessage, isBanmal });
    }
    // --- End AI Generation ---

    // Prepare data for Firestore
    const characterData = {
      name,
      description: finalDescription,
      detail,
      image: mainImageUrl, // Use the final URL
      firstMessage: finalFirstMessage, // Use the final determined value
      tags,
      isPublic,
      isDeleted: false,
      isNSFW,
      isBanmal: finalIsBanmal, // Use the final determined value
      creatorId: creatorId,
      creatorName: creatorName,
      conversationCount: 0,
      likesCount: 0,
      likedBy: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as any;

    // Add the document to the 'characters' collection
    const docRef = await addDoc(collection(db, 'characters'), characterData);
    console.log('Character created with ID:', docRef.id);

    // Return success response with the created character ID
    return NextResponse.json({ success: true, characterId: docRef.id }, { status: 201 });

  } catch (error) {
    console.error('Error creating bot:', error);
    // Check if the error is from AI generation specifically? Maybe add custom error type.
    if (error instanceof SyntaxError) { // JSON parsing error from request body
        return NextResponse.json({ error: 'Invalid JSON format in request' }, { status: 400 });
    }
    // Add more specific error handling if needed
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
