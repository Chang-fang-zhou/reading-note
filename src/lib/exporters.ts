import { Document, Packer, Paragraph, TextRun } from "docx";
import type { NoteItem, StoredBook } from "./types";
import { downloadBlob, formatTimestamp } from "./utils";

function noteToText(note: NoteItem) {
  return [
    `章节：${note.sectionTitle}`,
    `划线：${note.quote}`,
    `批注：${note.comment || "无"}`,
    `感想：${note.thought || "无"}`,
    `时间：${formatTimestamp(note.updatedAt)}`
  ].join("\n");
}

export function exportNotesAsTxt(book: StoredBook, notes: NoteItem[]) {
  const content = [
    `${book.title} 笔记导出`,
    `导出时间：${formatTimestamp(new Date().toISOString())}`,
    "",
    ...notes
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .flatMap((note) => [noteToText(note), "", "----------------", ""])
  ].join("\n");

  downloadBlob(new Blob([content], { type: "text/plain;charset=utf-8" }), `${book.title}-notes.txt`);
}

export async function exportNotesAsDocx(book: StoredBook, notes: NoteItem[]) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [new TextRun({ text: `${book.title} 笔记导出`, bold: true, size: 34 })]
          }),
          new Paragraph(`导出时间：${formatTimestamp(new Date().toISOString())}`),
          ...notes
            .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
            .flatMap((note) => [
              new Paragraph({
                spacing: { before: 240, after: 120 },
                children: [new TextRun({ text: note.sectionTitle, bold: true, size: 28 })]
              }),
              new Paragraph(`划线：${note.quote}`),
              new Paragraph(`批注：${note.comment || "无"}`),
              new Paragraph(`感想：${note.thought || "无"}`),
              new Paragraph(`时间：${formatTimestamp(note.updatedAt)}`)
            ])
        ]
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  downloadBlob(blob, `${book.title}-notes.docx`);
}
