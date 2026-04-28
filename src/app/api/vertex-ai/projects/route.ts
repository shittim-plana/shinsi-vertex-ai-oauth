import { NextRequest, NextResponse } from 'next/server';
import { getVertexAIAccessToken } from '@/utils/vertex-ai/token-manager';
import { GCP_PROJECTS_ENDPOINT } from '@/utils/vertex-ai/constants';

interface GCPProject {
  projectId: string;
  name: string;
  lifecycleState: string;
}

export async function POST(req: NextRequest) {
  let body: { uid?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  }

  const { uid } = body;
  if (!uid) {
    return NextResponse.json({ error: 'uid is required.' }, { status: 400 });
  }

  try {
    // Use getVertexAIAccessToken — does not require gcpProjectId, so a user
    // who connected OAuth can list all their projects even if they haven't
    // selected a specific project yet.
    const accessToken = await getVertexAIAccessToken(uid);
    if (!accessToken) {
      return NextResponse.json(
        { error: 'No valid Vertex AI credentials. Please reconnect your GCP account.' },
        { status: 401 },
      );
    }

    const response = await fetch(`${GCP_PROJECTS_ENDPOINT}?filter=lifecycleState:ACTIVE`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[VertexAI Projects] Failed for user ${uid}:`, errorData);
      return NextResponse.json(
        { error: 'Failed to fetch GCP projects.', details: errorData },
        { status: response.status },
      );
    }

    const data = await response.json();
    const projects: Array<{ projectId: string; name: string }> = (
      (data.projects || []) as GCPProject[]
    ).map((p) => ({
      projectId: p.projectId,
      name: p.name,
    }));

    return NextResponse.json({ projects });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[VertexAI Projects] Error for user ${uid}: ${errMsg}`);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
