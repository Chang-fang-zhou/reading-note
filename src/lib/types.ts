export type BookFormat = "epub" | "pdf" | "txt" | "md" | "docx";

export type BookBlockKind =
  | "title"
  | "subtitle"
  | "paragraph"
  | "quote"
  | "list"
  | "line"
  | "code";

export type BookBlock = {
  id: string;
  kind: BookBlockKind;
  text: string;
  indent?: number;
  fontScale?: number;
};

export type BookSection = {
  id: string;
  title: string;
  text: string;
  blocks: BookBlock[];
};

export type StoredBook = {
  id: string;
  title: string;
  author?: string;
  format: BookFormat;
  importedAt: string;
  fingerprint: string;
  sections: BookSection[];
};

export type NoteAnchor = {
  blockId: string;
  offset: number;
};

export type NoteItem = {
  id: string;
  bookId: string;
  sectionId: string;
  sectionTitle: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  startAnchor?: NoteAnchor;
  endAnchor?: NoteAnchor;
  comment: string;
  thought: string;
  createdAt: string;
  updatedAt: string;
};

export type SyncEnvelope = {
  workspaceId: string;
  bookId: string;
  notes: NoteItem[];
};
