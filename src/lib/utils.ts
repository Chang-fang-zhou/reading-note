export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export async function hashText(text: string) {
  const buffer = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

export function chunkText(text: string, size = 2800) {
  const normalized = text.replace(/\r/g, "");
  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    const boundary = Math.min(cursor + size, normalized.length);
    const slice = normalized.slice(cursor, boundary);
    const splitAt = slice.lastIndexOf("\n");
    const nextCursor =
      splitAt > 600 && boundary < normalized.length ? cursor + splitAt : boundary;
    chunks.push(normalized.slice(cursor, nextCursor).trim());
    cursor = nextCursor;
  }

  return chunks.filter(Boolean);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function formatTimestamp(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
