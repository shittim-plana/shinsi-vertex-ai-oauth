export type GenerateLoreRequest = {
  wikiContent: string;
  model: string;
  characterId?: string;
  requestId?: string;
};

export type TokenUsage = {
  prompt: number;
  output: number;
  thinking?: number;
  total: number;
};

export type GenerateLoreResponse = {
  lore: string;
  firstMessage: string;
  meta: {
    model: string;
    tokens: TokenUsage;
    chargedPoints: number;
    requestId?: string;
    latencyMs?: number;
  };
};