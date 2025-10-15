'use client';
import Link from 'next/link';

export default function PaymentCancelPage() {
  return (
    <main style={{ maxWidth: 640, margin: '40px auto', padding: 16 }}>
      <h1>결제 취소</h1>
      <p>결제가 취소되었습니다. 다시 시도하시거나 다른 결제 수단을 선택해주세요.</p>
      <div style={{ marginTop: 24 }}>
        <Link href="/">메인 페이지로 돌아가기</Link>
      </div>
    </main>
  );
}