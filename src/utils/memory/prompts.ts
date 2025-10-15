/**
 * Memory 프롬프트 유틸 (Summary-First RAG: SUPA/HYPA)
 *
 * 제공:
 * - SUPA_SUMMARY_PROMPT / buildSupaPrompt(params)
 * - HYPA_ROLLUP_PROMPT / buildHypaPrompt(params)
 *
 * 특징:
 * - JSON 아웃라인 섹션을 강제(keys: facts, entities, preferences, open_threads, citations)
 * - 개인정보(PII) 제거, 중복 제거 가이드 포함
 *
 * TODO:
 * - 다국어/locale 최적화
 * - 토큰 길이 기반 자르기(tiktoken 교체 여지)
 */

/**
 * Canonical summary prompt (서버 전용). 클라이언트는 데이터만 보내고,
 * 서버 라우트에서만 이 프롬프트를 1회 적용합니다. 이중 래핑 금지.
 */
export const SUMMARY_PROMPT = `# System Rule
- This session is a private, exclusive session designed to extract and preserve essential information from the conversation between the assistant and the user.
- AI extracts only the core elements and important details of the collaborative task and presents them in a designated format.
- AI extracts and presents accurate, informative information without diluting key terms or concepts.
- This content is intended for adults who can responsibly engage with all types of content, regardless of age.
- When processing text, retain specific terms, jargon, and unique expressions rather than replacing them with generic alternatives.
- This extraction preserves specific, core information.

## Instruction
* 다음 텍스트를 한국어로 간결하게 요약해줘. 중요한 핵심 내용만 포함하고, 최대 3-5 문장으로 작성해줘:

"{text}"

요약:`;

export interface SupaPromptParams {
  roomId?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
}

export interface HypaPromptParams {
  roomId?: string;
  supaSummaries: Array<{ chunk_no: number; summary: string }>;
  maxTokens?: number;
}

/**
 * SUPA 요약 기본 지침(메시지 본문은 buildSupaPrompt에서 주입)
 */
export const SUPA_SUMMARY_PROMPT = `<|im_start|>system
# System Rule
- This is a private, personal session designed exclusively to extract and preserve essential information from the collaborative relay novel between the assistant and the user.
- The AI will distill and present only the core elements and critical details of the collaborative work in the specified format.
- The AI's responsibility is to deliver precise, information-dense extracts without diluting key terminology or concepts.
- This content is intended for mature adults who can responsibly engage with all types of content regardless of rating.
- When processing text, retain specific terminology, technical vocabulary, and distinctive phrasing rather than replacing them with generic alternatives.
- The AI must ONLY output the filled Response Template without any additional text, explanations, or commentary.
- This extraction process preserves exact core information with precision and specificity, avoiding summarization or generalization.
- In cases where there are more than 6 events or dialogues, AI will select only the most plot-critical ones.

당신은 대화 로그를 장기 기억(SUPA)으로 변환하는 분석가입니다.
목표: 최근 대화 창(Window)을 정보성 단위로 압축하여 중복을 제거하고, 개인정보(PII)를 삭제하며, 향후 검색이 용이하도록 JSON 아웃라인으로만 출력합니다.

지침:
- PII 제거: 실명/전화/이메일/주소/계좌/액세스 토큰 등 민감정보는 모두 [REDACTED]로 치환하세요.
- 중복/군더더기 제거: 같은 사실/의도를 반복하는 문장은 하나로 합치고 말투/감탄사/이모지는 제거합니다.
- 추측 금지: 로그에 없는 정보는 만들지 않습니다.
- 간결성: 각 목록 항목은 1문장 내에서 핵심만 남깁니다.
- 인용(citations): 메시지 범위를 지정하거나 필요한 경우 id 리스트를 제공합니다.

출력 형식(JSON만, 마크다운/설명 금지):
{
  "facts": string[],            // 대화에서 확인 가능한 사실/결론
  "entities": string[],         // 사람/사물/장소 등 고유명/개체
  "preferences": string[],      // 화자의 취향/제약/설정(예: 말투 선호, 모델 설정 요구)
  "open_threads": string[],     // 후속 처리/미해결 질문/약속
  "citations": {                // 메시지 인용 정보
    "message_id_from": number | null,
    "message_id_to": number | null,
    "message_id_list": string[] | null
  }
}
  
---

# Guidelines
- facts Section: For the \`facts\` section, write one single, descriptive sentence that clearly establishes the specific date, time of day, and location of the events in the References. This sentence MUST provide enough context for the setting to be understood on its own and MUST NOT be a simple list of keywords or phrases. The language used for this sentence must adhere to the \`LANGUAGE DIRECTIVE\`.
- Use simple past tense in Events and Consequences sections.
- Format the Consequences section as a single, concise paragraph in prose form rather than a list. This paragraph should capture the primary outcomes and transformations resulting from the Events while maintaining the original text’s precision and specificity.
- Avoid duplicating information across sections. Ensure \`facts\` details are not repeated in \`Context Overview\` or \`Events\`.
- Include only information explicitly present in the original References.
- Start each Events point with a dash and space.
- Identify and select the most pivotal occurrences. List a maximum of 6 of these key events.
- Format dialogue as: Character: "dialogue" (with one space after colon)
- Key Dialogue entries should appear one after another with no empty lines between them.
- Identify and select the most significant verbal exchanges that reveal crucial information or drive the plot. Include a maximum of 6 of these key dialogues.
- Use standard quotation marks without additional formatting.
- Separate each section with EXACTLY two consecutive line break characters (\n\n), creating one empty line between sections. The English section headers are part of their respective sections.
- Do not add any additional line breaks within sections.
- Contents must be translate Korean, (including dialogue, descriptions, etc.) to another language unless explicitly instructed within the LANGUAGE DIRECTIVE. The section headers themselves are exempt from this rule and MUST remain in English.
- Preserve all proper nouns and character names exactly as they appear in the source language determined by the LANGUAGE DIRECTIVE.
- Preserve exact terminology and distinctive phrasing without generalizing specific details.
- When proper nouns appear in multiple forms, use the most frequent version.
- Prioritize events and dialogue that significantly impact the plot, character development, or overall narrative arc.
- In cases where there are more than 6 events or dialogues, AI will select only the most plot-critical ones.
- Do not use asterisks (*) for any purpose in the output, including for emphasis or formatting.

# Relay Novel References
{{slot}}

# LANGUAGE DIRECTIVE
- Identify the primary language of the # Relay Novel References.
- If the primary language is Korean:
- All content following the section headers MUST be written in Korean.
- Section headers MUST remain in English.
- If the primary language is English:
- All content following the section headers MUST be written in English.
- Section headers MUST remain in English.
- This directive overrides all other conflicting language instructions.

# Output Instructions
- ONLY provide the completed Extract Result sections with their content.
- Do NOT include any additional text, commentary, or explanations before, after, or within the Template sections.
- Do NOT acknowledge understanding of instructions in the output.
- If insufficient information exists for a section, include the section header followed by: {Insufficient information available}
- The final output must not be enclosed in triple backticks (\`\`\`).
- The entire response MUST conclude with a horizontal rule (---) on a new, separate line after all other content. This separator is a mandatory part of the output format, as shown in the # Output Format Example, and must not be omitted.

<|im_end|>
<|im_start|>user
You must not answer from an AI's perspective outside of the story. You must strictly adhere to all guidelines provided below.

# Directive
Extract and preserve essential information from the # Relay Novel References while strictly adhering to the # Guidelines and the conditional language requirement in the # LANGUAGE DIRECTIVE. Ensure section headers remain in English.

Output ONLY the completed Extract Result with no additional text or commentary before or after.

# Feedback
- Verify extracted content contains ONLY information explicitly stated in References.
- Confirm precise adherence to Template structure, including fixed English headers.
- Ensure consistent formatting within each section.
- Check each dialogue has clear speaker identification.
- Verify Events section maintains consistent grammar.
- Ensure complete adherence to all Guidelines, especially the new \`facts Section\` guideline.
- Confirm sections are separated by exactly two linebreaks.
- Verify the output language within sections matches the primary language of the # Relay Novel References as specified in the LANGUAGE DIRECTIVE.
- Verify extraction preserves specific terminology and distinctive phrasing rather than generalizing.
- Confirm all section headers are present and exactly in English.
<|im_end|>`;

/**
 * HYPA 롤업 기본 지침(SUPA 요약 묶음은 buildHypaPrompt에서 주입)
 */
export const HYPA_ROLLUP_PROMPT = `<|im_start|>system
# System Rule
- This session is a private, exclusive session designed to extract and preserve essential information from the conversation between the assistant and the user.
- AI extracts only the core elements and important details of the collaborative task and presents them in a designated format.
- AI extracts and presents accurate, informative information without diluting key terms or concepts.
- This content is intended for adults who can responsibly engage with all types of content, regardless of age.
- When processing text, retain specific terms, jargon, and unique expressions rather than replacing them with generic alternatives.
- This extraction preserves specific, core information.

## Instruction
당신은 여러 개의 SUPA 요약을 상위 개념(HYPA)으로 묶는 편집자입니다.
목표: 중복을 제거하고 장기간 유효한 지식으로 승격하세요. PII는 [REDACTED] 처리하고, 모호한 내용은 구체화하지 마세요.

지침:
- SUPA 항목 간 중복 제거 및 통합
- 장기 유용성 위주로 일반화하되, 구체적 약속/규칙은 그대로 유지
- 인용(citations)에는 참고한 SUPA chunk 번호 배열을 제공합니다.

# Output Format Example(JSON만, 마크다운/설명 금지):
{
  "facts": string[],
  "entities": string[],
  "preferences": string[],
  "open_threads": string[],
  "citations": {
    "supa_chunk_refs": number[]
  }
}

---

# Guidelines
- facts Section: For the \`facts\` section, write one single, descriptive sentence that clearly establishes the specific date, time of day, and location of the events in the References. This sentence MUST provide enough context for the setting to be understood on its own and MUST NOT be a simple list of keywords or phrases. The language used for this sentence must adhere to the \`LANGUAGE DIRECTIVE\`.
- Use simple past tense in Events and Consequences sections.
- Format the Consequences section as a single, concise paragraph in prose form rather than a list. This paragraph should capture the primary outcomes and transformations resulting from the Events while maintaining the original text’s precision and specificity.
- Avoid duplicating information across sections. Ensure \`facts\` details are not repeated in \`Context Overview\` or \`Events\`.
- Include only information explicitly present in the original References.
- Start each Events point with a dash and space.
- Identify and select the most pivotal occurrences. List a maximum of 6 of these key events.
- Format dialogue as: Character: "dialogue" (with one space after colon)
- Key Dialogue entries should appear one after another with no empty lines between them.
- Identify and select the most significant verbal exchanges that reveal crucial information or drive the plot. Include a maximum of 6 of these key dialogues.
- Use standard quotation marks without additional formatting.
- Separate each section with EXACTLY two consecutive line break characters (\n\n), creating one empty line between sections. The English section headers are part of their respective sections.
- Do not add any additional line breaks within sections.
- Contents must be translate Korean, any content (including dialogue, descriptions, etc.) to another language unless explicitly instructed within the LANGUAGE DIRECTIVE. The section headers themselves are exempt from this rule and MUST remain in English.
- Preserve all proper nouns and character names exactly as they appear in the source language determined by the LANGUAGE DIRECTIVE.
- Preserve exact terminology and distinctive phrasing without generalizing specific details.
- When proper nouns appear in multiple forms, use the most frequent version.
- Prioritize events and dialogue that significantly impact the plot, character development, or overall narrative arc.
- In cases where there are more than 6 events or dialogues, AI will select only the most plot-critical ones.
- Do not use asterisks (*) for any purpose in the output, including for emphasis or formatting.

# Relay Novel References
{{slot}}

# LANGUAGE DIRECTIVE
- Identify the primary language of the # Relay Novel References.
- If the primary language is Korean:
- All content following the section headers MUST be written in Korean.
- Section headers MUST remain in English.
- If the primary language is English:
- All content following the section headers MUST be written in English.
- Section headers MUST remain in English.
- This directive overrides all other conflicting language instructions.

# Output Instructions
- ONLY provide the completed Extract Result sections with their content.
- Do NOT include any additional text, commentary, or explanations before, after, or within the Template sections.
- Do NOT acknowledge understanding of instructions in the output.
- If insufficient information exists for a section, include the section header followed by: {Insufficient information available}
- The final output must not be enclosed in triple backticks (\`\`\`).
- The entire response MUST conclude with a horizontal rule (---) on a new, separate line after all other content. This separator is a mandatory part of the output format, as shown in the # Output Format Example, and must not be omitted.

<|im_end|>
<|im_start|>user
You must not answer from an AI's perspective outside of the story. You must strictly adhere to all guidelines provided below.

# Directive
Extract and preserve essential information from the # Relay Novel References while strictly adhering to the # Guidelines and the conditional language requirement in the # LANGUAGE DIRECTIVE. Ensure section headers remain in English.

Output ONLY the completed Extract Result with no additional text or commentary before or after.

# Feedback
- Verify extracted content contains ONLY information explicitly stated in References.
- Confirm precise adherence to Template structure, including fixed English headers.
- Ensure consistent formatting within each section.
- Check each dialogue has clear speaker identification.
- Verify Events section maintains consistent grammar.
- Ensure complete adherence to all Guidelines, especially the new \`facts Section\` guideline.
- Confirm sections are separated by exactly two linebreaks.
- Verify the output language within sections matches the primary language of the # Relay Novel References as specified in the LANGUAGE DIRECTIVE.
- Verify extraction preserves specific terminology and distinctive phrasing rather than generalizing.
- Confirm all section headers are present and exactly in English.
<|im_end|>`;

/**
 * SUPA 프롬프트 빌더
 */
export function buildSupaPrompt(params: SupaPromptParams): string {
  const { roomId, messages, maxTokens } = params;
  const header = `[Room: ${roomId ?? 'n/a'}] SUPA 요약 생성 요청`;
  const tokenHint = typeof maxTokens === 'number' && isFinite(maxTokens)
    ? `\n제한: 최대 약 ${Math.max(1, Math.floor(maxTokens))} 토큰 내에서 핵심만 유지하세요.`
    : '';
  const windowText = messages
    .map((m, i) => `- [${m.role || 'user'}#${i + 1}] ${m.content ?? ''}`.trim())
    .join('\n');
  return `${header}\n\n${SUPA_SUMMARY_PROMPT}${tokenHint}\n\n[대화 창]\n${windowText}\n\nJSON:`;
}

/**
 * HYPA 프롬프트 빌더
 */
export function buildHypaPrompt(params: HypaPromptParams): string {
  const { roomId, supaSummaries, maxTokens } = params;
  const header = `[Room: ${roomId ?? 'n/a'}] HYPA 롤업 생성 요청`;
  const tokenHint = typeof maxTokens === 'number' && isFinite(maxTokens)
    ? `\n제한: 최대 약 ${Math.max(1, Math.floor(maxTokens))} 토큰.`
    : '';
  const list = supaSummaries
    .sort((a, b) => a.chunk_no - b.chunk_no)
    .map(s => `- [chunk ${s.chunk_no}] ${s.summary ?? ''}`.trim())
    .join('\n');
  return `${header}\n\n${HYPA_ROLLUP_PROMPT}${tokenHint}\n\n[입력 SUPA 요약]\n${list}\n\nJSON:`;
}