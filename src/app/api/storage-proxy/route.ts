import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  // Get the URL from the query parameters
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'No URL provided' }, { status: 400 });
  }

  try {
    // Make the request to Firebase Storage
    const response = await fetch(url);
    
    if (!response.ok) {
      return NextResponse.json(
        { error: `Storage request failed with status ${response.status}` }, 
        { status: response.status }
      );
    }

    // Get the content type from the response
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    
    // Get the response as an array buffer
    const data = await response.arrayBuffer();

    // Create a new response with the data and appropriate headers
    const newResponse = new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Cache-Control': 'public, max-age=3600',
      },
    });

    return newResponse;
  } catch (error) {
    console.error('Storage proxy error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch from storage' }, 
      { status: 500 }
    );
  }
}

export async function OPTIONS() {
  // Handle preflight requests
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '3600',
    },
  });
}