import { NextRequest, NextResponse } from 'next/server';

// Deprecated endpoint: Admin SDK logic removed by request.
// Success page handles client-side crediting and redirects automatically.
export async function POST(_req: NextRequest) {
  return NextResponse.json(
    { error: 'Deprecated endpoint. Client-side success flow credits points directly.' },
    { status: 410 }
  );
}