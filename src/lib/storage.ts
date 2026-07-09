import { openDB } from "idb";
import type { NoteItem, StoredBook } from "./types";

const DB_NAME = "reader-notes-sync";
const BOOKS = "books";
const NOTES = "notes";

let dbPromise:
  | ReturnType<typeof openDB>
  | null = null;

function getDb() {
  if (typeof window === "undefined") {
    throw new Error("本地存储只能在浏览器环境中使用");
  }

  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        const booksStore = db.createObjectStore(BOOKS, { keyPath: "id" });
        booksStore.createIndex("byImportedAt", "importedAt");

        const notesStore = db.createObjectStore(NOTES, { keyPath: "id" });
        notesStore.createIndex("byBookId", "bookId");
      }
    });
  }

  return dbPromise;
}

export async function listBooks() {
  return (await getDb()).getAll(BOOKS) as Promise<StoredBook[]>;
}

export async function saveBook(book: StoredBook) {
  return (await getDb()).put(BOOKS, book);
}

export async function getBook(bookId: string) {
  return (await getDb()).get(BOOKS, bookId) as Promise<StoredBook | undefined>;
}

export async function saveNotes(notes: NoteItem[]) {
  const db = await getDb();
  const tx = db.transaction(NOTES, "readwrite");
  await Promise.all(notes.map((note) => tx.store.put(note)));
  await tx.done;
}

export async function replaceBookNotes(bookId: string, notes: NoteItem[]) {
  const db = await getDb();
  const tx = db.transaction(NOTES, "readwrite");
  const existing = await tx.store.index("byBookId").getAllKeys(bookId);
  await Promise.all(existing.map((key) => tx.store.delete(key)));
  await Promise.all(notes.map((note) => tx.store.put(note)));
  await tx.done;
}

export async function listNotesByBook(bookId: string) {
  return (await getDb()).getAllFromIndex(NOTES, "byBookId", bookId) as Promise<NoteItem[]>;
}
