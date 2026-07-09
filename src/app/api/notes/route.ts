import { NextRequest, NextResponse } from "next/server";
import { isSyncConfigured, loadServerNotes, upsertServerNotes } from "@/lib/server-store";
import type { SyncEnvelope } from "@/lib/types";

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const bookId = request.nextUrl.searchParams.get("bookId");

  if (!workspaceId || !bookId) {
    return NextResponse.json({ error: "workspaceId 和 bookId 不能为空" }, { status: 400 });
  }

  if (!isSyncConfigured()) {
    return NextResponse.json({ enabled: false, notes: [] });
  }

  const notes = await loadServerNotes(workspaceId, bookId);
  return NextResponse.json({ enabled: true, notes });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as SyncEnvelope;

  if (!body.workspaceId || !body.bookId) {
    return NextResponse.json({ error: "缺少同步标识" }, { status: 400 });
  }

  if (!isSyncConfigured()) {
    return NextResponse.json({ enabled: false });
  }

  await upsertServerNotes(body.workspaceId, body.bookId, body.notes ?? []);
  return NextResponse.json({ enabled: true, count: body.notes.length });
}
