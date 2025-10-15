/**
 * 서버 전용 Admin/Anon Supabase 클라이언트 유틸.
 *
 * Required server runtime env keys (DO NOT expose to client):
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Security notes:
 * - 이 파일은 서버 전용입니다. 클라이언트 환경에서 import/use 시 즉시 오류를 던집니다.
 * - 서비스 롤 키는 절대로 브라우저로 번들되면 안 됩니다.
 *
 * Optional (not required at this stage):
 * - SUPABASE_ANON_KEY (for read-only anon client)
 */
import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function assertServerOnly(): void {
  if (typeof window !== 'undefined') {
    throw new Error('supabaseClient: This module must only be used on the server (server-only).');
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`supabaseClient: Missing required environment variable: ${name}`);
  }
  return v;
}

let adminClient: SupabaseClient | null = null;
/**
 * 서버 전용 Admin 클라이언트 팩토리
 * - Service Role Key 사용
 * - 세션 지속 비활성화 (persistSession: false)
 */
export function getSupabaseAdminClient(): SupabaseClient {
  assertServerOnly();
  if (adminClient) return adminClient;

  const url = requireEnv('SUPABASE_URL');
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  adminClient = createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'arona-bot/pgvector-admin',
      },
    },
  });

  return adminClient;
}

let anonClient: SupabaseClient | null = null;
/**
 * 읽기 전용 anon 클라이언트 (미사용 예정이지만 확장 대비)
 * - 이 또한 서버 전용으로 제한
 */
export function getSupabaseAnonClient(): SupabaseClient {
  assertServerOnly();
  if (anonClient) return anonClient;

  const url = requireEnv('SUPABASE_URL');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) {
    throw new Error('supabaseClient: SUPABASE_ANON_KEY is not set; anon client is optional but required when used.');
  }

  anonClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'X-Client-Info': 'arona-bot/pgvector-anon',
      },
    },
  });

  return anonClient;
}