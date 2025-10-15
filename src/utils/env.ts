const splitAndClean = (raw?: string): string[] => {
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
};

export const getGoogleAiStudioApiKeys = (): string[] => {
  const keys = new Set<string>();
  splitAndClean(process.env.GOOGLE_AI_STUDIO_API_KEYS).forEach((key) => keys.add(key));
  splitAndClean(process.env.GOOGLE_AI_STUDIO_API_KEY_LIST).forEach((key) => keys.add(key));
  const single = (process.env.GOOGLE_AI_STUDIO_API_KEY || '').trim();
  if (single) keys.add(single);
  return Array.from(keys);
};

export const getFirstGoogleAiStudioApiKey = (): string | undefined => {
  const [first] = getGoogleAiStudioApiKeys();
  return first;
};
