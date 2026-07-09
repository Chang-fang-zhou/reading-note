import { neon } from "@neondatabase/serverless";
import type { NoteItem } from "./types";

export function isSyncConfigured() {
  return Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL);
}

function getSql() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error("缺少 DATABASE_URL");
  }

  return neon(connectionString);
}

export async function ensureNotesTable() {
  const sql = getSql();
  await sql`
    create table if not exists reader_notes (
      workspace_id text not null,
      book_id text not null,
      note_id text not null,
      payload jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (workspace_id, book_id, note_id)
    );
  `;
}

export async function loadServerNotes(workspaceId: string, bookId: string) {
  await ensureNotesTable();
  const sql = getSql();
  const result = (await sql`
    select payload
    from reader_notes
    where workspace_id = ${workspaceId}
      and book_id = ${bookId}
    order by updated_at asc
  `) as Array<{ payload: NoteItem }>;

  return result.map((row) => row.payload);
}

export async function upsertServerNotes(workspaceId: string, bookId: string, notes: NoteItem[]) {
  await ensureNotesTable();
  const sql = getSql();
  await sql`
    delete from reader_notes
    where workspace_id = ${workspaceId}
      and book_id = ${bookId}
  `;

  for (const note of notes) {
    await sql`
      insert into reader_notes (workspace_id, book_id, note_id, payload, updated_at)
      values (${workspaceId}, ${bookId}, ${note.id}, ${JSON.stringify(note)}::jsonb, ${note.updatedAt})
    `;
  }
}
