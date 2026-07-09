"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { BookBlock, BookSection, NoteAnchor, NoteItem, StoredBook } from "@/lib/types";
import { exportNotesAsDocx, exportNotesAsTxt } from "@/lib/exporters";
import { parseBookFile } from "@/lib/book-parser";
import {
  getBook,
  listBooks,
  listNotesByBook,
  replaceBookNotes,
  saveBook,
  saveNotes
} from "@/lib/storage";
import { formatTimestamp, makeId } from "@/lib/utils";

const SYNC_KEY = "reader-notes-workspace-id";

type DraftSelection = {
  sectionId: string;
  sectionTitle: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  startAnchor: NoteAnchor;
  endAnchor: NoteAnchor;
};

function getSectionBlocks(section: BookSection) {
  if (section.blocks?.length) {
    return section.blocks;
  }

  return [
    {
      id: `${section.id}_block_1`,
      kind: "paragraph" as const,
      text: section.text
    }
  ];
}

function buildSectionIndex(section: BookSection) {
  const blocks = getSectionBlocks(section);
  const blockOffsets = new Map<string, number>();
  let cursor = 0;

  blocks.forEach((block, index) => {
    blockOffsets.set(block.id, cursor);
    cursor += block.text.length;
    if (index < blocks.length - 1) {
      cursor += 1;
    }
  });

  return { blocks, blockOffsets };
}

function getBlockOffset(blockElement: HTMLElement, range: Range, edge: "start" | "end") {
  const walker = document.createTreeWalker(blockElement, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let cursor = 0;

  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (node === (edge === "start" ? range.startContainer : range.endContainer)) {
      return cursor + (edge === "start" ? range.startOffset : range.endOffset);
    }
    cursor += length;
  }

  return -1;
}

function renderTextWithHighlight(block: BookBlock, highlights: Array<{ start: number; end: number; id: string }>) {
  if (highlights.length === 0) {
    return [block.text];
  }

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  highlights.forEach((highlight) => {
    const start = Math.max(cursor, highlight.start);
    const end = Math.max(start, highlight.end);

    if (start > cursor) {
      nodes.push(block.text.slice(cursor, start));
    }

    nodes.push(
      <mark key={`${highlight.id}_${start}_${end}`} data-note-id={highlight.id}>
        {block.text.slice(start, end)}
      </mark>
    );

    cursor = end;
  });

  if (cursor < block.text.length) {
    nodes.push(block.text.slice(cursor));
  }

  return nodes;
}

function getBlockHighlights(
  section: BookSection,
  block: BookBlock,
  sectionNotes: NoteItem[]
): Array<{ start: number; end: number; id: string }> {
  const { blocks, blockOffsets } = buildSectionIndex(section);
  const blockIndex = blocks.findIndex((item) => item.id === block.id);
  const blockStart = blockOffsets.get(block.id) ?? 0;
  const blockEnd = blockStart + block.text.length;

  return sectionNotes
    .map((note) => {
      const normalizedStart =
        note.startAnchor && note.endAnchor
          ? (() => {
              const startIndex = blocks.findIndex((item) => item.id === note.startAnchor?.blockId);
              const endIndex = blocks.findIndex((item) => item.id === note.endAnchor?.blockId);

              if (startIndex === -1 || endIndex === -1 || blockIndex < startIndex || blockIndex > endIndex) {
                return null;
              }

              const start =
                blockIndex === startIndex
                  ? note.startAnchor.offset
                  : 0;
              const end =
                blockIndex === endIndex
                  ? note.endAnchor.offset
                  : block.text.length;

              return { start, end };
            })()
          : {
              start: Math.max(note.startOffset - blockStart, 0),
              end: Math.min(note.endOffset - blockStart, block.text.length)
            };

      if (!normalizedStart) {
        return null;
      }

      const { start, end } = normalizedStart;

      if (end <= 0 || start >= block.text.length || start === end) {
        return null;
      }

      return {
        id: note.id,
        start: Math.max(0, start),
        end: Math.min(block.text.length, end)
      };
    })
    .filter((item): item is { start: number; end: number; id: string } => Boolean(item))
    .sort((a, b) => a.start - b.start);
}

export default function HomePage() {
  const readerRef = useRef<HTMLDivElement | null>(null);
  const [books, setBooks] = useState<StoredBook[]>([]);
  const [activeBookId, setActiveBookId] = useState("");
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [workspaceId, setWorkspaceId] = useState("");
  const [draft, setDraft] = useState<DraftSelection | null>(null);
  const [comment, setComment] = useState("");
  const [thought, setThought] = useState("");
  const [status, setStatus] = useState("准备就绪");
  const [isBusy, setIsBusy] = useState(false);

  const activeBook = useMemo(
    () => books.find((item) => item.id === activeBookId) ?? null,
    [books, activeBookId]
  );
  const activeSection = activeBook?.sections[sectionIndex] ?? null;
  const activeSectionBlocks = useMemo(
    () => (activeSection ? getSectionBlocks(activeSection) : []),
    [activeSection]
  );
  const sectionNotes = useMemo(
    () => notes.filter((item) => item.sectionId === activeSection?.id),
    [notes, activeSection]
  );

  useEffect(() => {
    const boot = async () => {
      const loadedBooks = await listBooks();
      const sortedBooks = loadedBooks.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
      setBooks(sortedBooks);
      if (sortedBooks[0]) {
        setActiveBookId(sortedBooks[0].id);
      }
      setWorkspaceId(localStorage.getItem(SYNC_KEY) ?? "");
    };

    void boot();
  }, []);

  useEffect(() => {
    if (!activeBookId) {
      setNotes([]);
      return;
    }

    const loadBookNotes = async () => {
      const localNotes = await listNotesByBook(activeBookId);
      setNotes(localNotes.sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setSectionIndex(0);
    };

    void loadBookNotes();
  }, [activeBookId]);

  useEffect(() => {
    localStorage.setItem(SYNC_KEY, workspaceId);
  }, [workspaceId]);

  async function refreshBooks(selectBookId?: string) {
    const loadedBooks = await listBooks();
    const sortedBooks = loadedBooks.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    setBooks(sortedBooks);
    if (selectBookId) {
      setActiveBookId(selectBookId);
    }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setIsBusy(true);
    setStatus(`正在导入 ${file.name}`);

    try {
      const book = await parseBookFile(file);
      await saveBook(book);
      await refreshBooks(book.id);
      setStatus(`已导入《${book.title}》`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "导入失败");
    } finally {
      setIsBusy(false);
      event.target.value = "";
    }
  }

  function captureSelection() {
    if (!activeSection || !readerRef.current) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return;
    }

    const range = selection.getRangeAt(0);
    if (range.collapsed || !readerRef.current.contains(range.commonAncestorContainer)) {
      return;
    }

    const startBlockElement = (range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement
    )?.closest<HTMLElement>("[data-block-id]");
    const endBlockElement = (range.endContainer instanceof Element
      ? range.endContainer
      : range.endContainer.parentElement
    )?.closest<HTMLElement>("[data-block-id]");

    if (!startBlockElement || !endBlockElement) {
      setStatus("请在正文区域里选择文字");
      return;
    }

    const startBlockId = startBlockElement.dataset.blockId;
    const endBlockId = endBlockElement.dataset.blockId;
    if (!startBlockId || !endBlockId) {
      return;
    }

    const startWithinBlock = getBlockOffset(startBlockElement, range, "start");
    const endWithinBlock = getBlockOffset(endBlockElement, range, "end");
    const quote = selection.toString().trim();
    const { blockOffsets } = buildSectionIndex(activeSection);

    if (startWithinBlock < 0 || endWithinBlock < 0 || !quote) {
      setStatus("这次划线没有成功识别，请再试一次");
      return;
    }

    const startBase = blockOffsets.get(startBlockId);
    const endBase = blockOffsets.get(endBlockId);

    if (startBase === undefined || endBase === undefined) {
      return;
    }

    setDraft({
      sectionId: activeSection.id,
      sectionTitle: activeSection.title,
      quote,
      startOffset: startBase + startWithinBlock,
      endOffset: endBase + endWithinBlock,
      startAnchor: { blockId: startBlockId, offset: startWithinBlock },
      endAnchor: { blockId: endBlockId, offset: endWithinBlock }
    });
    setComment("");
    setThought("");
    setStatus("已捕捉这段划线，补充批注后就能保存");
  }

  async function persistNotes(nextNotes: NoteItem[], syncMessage: string) {
    if (!activeBookId) {
      return;
    }

    await replaceBookNotes(activeBookId, nextNotes);
    setNotes(nextNotes);

    if (workspaceId.trim()) {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: workspaceId.trim(),
          bookId: activeBookId,
          notes: nextNotes
        })
      });
      const result = (await response.json()) as { enabled?: boolean };
      setStatus(result.enabled ? syncMessage : "已保存到本机，云端同步未启用");
      return;
    }

    setStatus("已保存到本机");
  }

  async function handleSaveNote() {
    if (!activeBookId || !draft) {
      return;
    }

    const now = new Date().toISOString();
    const note: NoteItem = {
      id: makeId("note"),
      bookId: activeBookId,
      sectionId: draft.sectionId,
      sectionTitle: draft.sectionTitle,
      quote: draft.quote,
      startOffset: draft.startOffset,
      endOffset: draft.endOffset,
      startAnchor: draft.startAnchor,
      endAnchor: draft.endAnchor,
      comment: comment.trim(),
      thought: thought.trim(),
      createdAt: now,
      updatedAt: now
    };

    const nextNotes = [...notes, note];
    await saveNotes([note]);
    await persistNotes(nextNotes, "已保存并同步到云端");
    setDraft(null);
    setComment("");
    setThought("");
    window.getSelection()?.removeAllRanges();
  }

  async function handlePullRemoteNotes() {
    if (!workspaceId.trim() || !activeBookId) {
      setStatus("先填写同步口令，再拉取云端笔记");
      return;
    }

    setStatus("正在拉取云端笔记");
    const response = await fetch(
      `/api/notes?workspaceId=${encodeURIComponent(workspaceId.trim())}&bookId=${encodeURIComponent(activeBookId)}`
    );
    const result = (await response.json()) as { enabled?: boolean; notes?: NoteItem[] };

    if (!result.enabled) {
      setStatus("当前部署还没接入云端数据库");
      return;
    }

    const remoteNotes = result.notes ?? [];
    await replaceBookNotes(activeBookId, remoteNotes);
    setNotes(remoteNotes);
    setStatus(`已拉取 ${remoteNotes.length} 条云端笔记`);
  }

  async function reopenBook(bookId: string) {
    const book = await getBook(bookId);
    if (!book) {
      return;
    }
    setActiveBookId(book.id);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Vercel 可部署 · 手机电脑可同步</p>
          <h1>把电子书划线、批注、感想和导出整理放到一个地方</h1>
          <p className="intro">
            现在的阅读器会尽量保留 EPUB 的段落结构，以及 PDF 的页内行块和缩进。这样划线时更稳，视觉上也更接近原书节奏。
          </p>
        </div>
        <div className="statusCard">
          <span>当前状态</span>
          <strong>{status}</strong>
        </div>
      </section>

      <section className="grid">
        <aside className="panel sidebar">
          <label className="upload">
            <input
              type="file"
              accept=".epub,.pdf,.txt,.md,.docx"
              onChange={handleImport}
              disabled={isBusy}
            />
            <span>{isBusy ? "正在处理中..." : "导入电子书"}</span>
          </label>

          <div className="syncBox">
            <label>同步口令</label>
            <input
              value={workspaceId}
              onChange={(event) => setWorkspaceId(event.target.value)}
              placeholder="例如 my-reading-space"
            />
            <button onClick={() => void handlePullRemoteNotes()}>拉取云端笔记</button>
          </div>

          <div className="bookList">
            <h2>书架</h2>
            {books.length === 0 ? <p>先导入一本书开始。</p> : null}
            {books.map((book) => (
              <button
                key={book.id}
                className={book.id === activeBookId ? "bookItem active" : "bookItem"}
                onClick={() => void reopenBook(book.id)}
              >
                <strong>{book.title}</strong>
                <span>
                  {book.format.toUpperCase()} · {book.sections.length} 段
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel readerPanel">
          {activeBook && activeSection ? (
            <>
              <header className="readerHeader">
                <div>
                  <h2>{activeBook.title}</h2>
                  <p>
                    {activeBook.author ? `${activeBook.author} · ` : ""}
                    {activeBook.format.toUpperCase()} · {activeBook.sections.length} 个阅读片段
                  </p>
                </div>
                <div className="pager">
                  <button onClick={() => setSectionIndex((value) => Math.max(0, value - 1))}>
                    上一段
                  </button>
                  <span>
                    {sectionIndex + 1} / {activeBook.sections.length}
                  </span>
                  <button
                    onClick={() =>
                      setSectionIndex((value) =>
                        Math.min(activeBook.sections.length - 1, value + 1)
                      )
                    }
                  >
                    下一段
                  </button>
                </div>
              </header>

              <div className="sectionMeta">
                <strong>{activeSection.title}</strong>
                <button onClick={captureSelection}>把当前选中文字设为划线</button>
              </div>

              <article ref={readerRef} className={`reader reader-${activeBook.format}`}>
                {activeSectionBlocks.map((block) => {
                  const highlights = getBlockHighlights(activeSection, block, sectionNotes);

                  return (
                    <div
                      key={block.id}
                      data-block-id={block.id}
                      className={`readerBlock block-${block.kind}`}
                      style={{
                        paddingLeft: block.indent ? `${Math.round(block.indent * 100)}%` : undefined,
                        fontSize: block.fontScale ? `${block.fontScale}em` : undefined
                      }}
                    >
                      {renderTextWithHighlight(block, highlights)}
                    </div>
                  );
                })}
              </article>
            </>
          ) : (
            <div className="emptyState">导入一本书后，这里会出现阅读界面。</div>
          )}
        </section>

        <aside className="panel notesPanel">
          <div className="draftCard">
            <h2>本次划线</h2>
            {draft ? (
              <>
                <blockquote>{draft.quote}</blockquote>
                <textarea
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="写下这段划线的批注"
                  rows={4}
                />
                <textarea
                  value={thought}
                  onChange={(event) => setThought(event.target.value)}
                  placeholder="记录此刻的临时感想"
                  rows={4}
                />
                <button onClick={() => void handleSaveNote()}>保存这条笔记</button>
              </>
            ) : (
              <p>在中间阅读区选中一段文字，然后点击“把当前选中文字设为划线”。</p>
            )}
          </div>

          <div className="notesHeader">
            <h2>本书笔记</h2>
            <div className="exportButtons">
              <button
                onClick={() => activeBook && exportNotesAsTxt(activeBook, notes)}
                disabled={!activeBook || notes.length === 0}
              >
                导出 TXT
              </button>
              <button
                onClick={() => activeBook && void exportNotesAsDocx(activeBook, notes)}
                disabled={!activeBook || notes.length === 0}
              >
                导出 Word
              </button>
            </div>
          </div>

          <div className="noteFeed">
            {notes.length === 0 ? <p>这本书还没有笔记。</p> : null}
            {[...notes]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((note) => (
                <article key={note.id} className="noteCard">
                  <span>{note.sectionTitle}</span>
                  <blockquote>{note.quote}</blockquote>
                  {note.comment ? <p>批注：{note.comment}</p> : null}
                  {note.thought ? <p>感想：{note.thought}</p> : null}
                  <time>{formatTimestamp(note.updatedAt)}</time>
                </article>
              ))}
          </div>
        </aside>
      </section>
    </main>
  );
}
