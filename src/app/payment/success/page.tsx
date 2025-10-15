import Link from 'next/link';
import React, { Suspense } from 'react';
import PaymentSuccessClient from './SuccessClient';

export const dynamic = 'force-dynamic';

export default function PaymentSuccessPage() {
  return (
    <main suppressHydrationWarning style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>결제 성공</h1>
      <p>포인트 충전 요청이 완료되었습니다. 잠시 후 잔액에 반영됩니다.</p>

      <Suspense fallback={null}>
        <PaymentSuccessClient />
      </Suspense>

      <div style={{ marginTop: 24 }}>
        <Link href="/">메인 페이지로 돌아가기</Link>
      </div>
    </main>
  );
}