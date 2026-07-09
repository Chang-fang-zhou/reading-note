import * as mammoth from "mammoth";
import type { BookBlock, BookFormat, BookSection, StoredBook } from "./types";
import { chunkText, hashText, makeId } from "./utils";

type ParsedBookPayload = {
  title: string;
  author?: string;
  format: BookFormat;
  sections: BookSection[];
  fingerprint: string;
};

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  fontName?: string;
};

type EpubSectionLike = {
  idref?: string;
  href?: string;
  linear?: boolean | string;
  render?: () => Promise<string>;
  load?: (loader: unknown) => Promise<unknown>;
  unload?: () => void;
};

function extensionToFormat(name: string): BookFormat | null {
  const ext = name.toLowerCase().split(".").pop();
  if (ext === "epub" || ext === "pdf" || ext === "txt" || ext === "md" || ext === "docx") {
    return ext;
  }
  return null;
}

function buildBlock(id: string, kind: BookBlock["kind"], text: string, extras?: Partial<BookBlock>) {
  return {
    id,
    kind,
    text,
    ...extras
  };
}

function blocksToSection(id: string, title: string, blocks: BookBlock[]): BookSection {
  const normalized = blocks
    .map((block) => ({ ...block, text: block.text.replace(/\r/g, "").trimEnd() }))
    .filter((block) => block.text.trim());

  return {
    id,
    title,
    blocks: normalized,
    text: normalized.map((block) => block.text).join("\n")
  };
}

function buildSectionsFromText(source: string, prefix: string) {
  return chunkText(source).map((text, index) =>
    blocksToSection(
      `${prefix}_${index + 1}`,
      `${prefix === "page" ? "第" : "片段"} ${index + 1}`,
      [buildBlock(`${prefix}_${index + 1}_block_1`, "paragraph", text)]
    )
  );
}

function collectEpubBlocks(root: ParentNode, sectionId: string) {
  const blocks: BookBlock[] = [];
  const selectors = "h1, h2, h3, h4, p, li, blockquote, pre";
  const nodes = Array.from(root.querySelectorAll(selectors));

  nodes.forEach((node, index) => {
    const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (!text) {
      return;
    }

    const tagName = node.tagName.toLowerCase();
    const kind: BookBlock["kind"] =
      tagName === "h1"
        ? "title"
        : tagName === "h2" || tagName === "h3" || tagName === "h4"
          ? "subtitle"
          : tagName === "blockquote"
            ? "quote"
            : tagName === "li"
              ? "list"
              : tagName === "pre"
                ? "code"
                : "paragraph";

    blocks.push(buildBlock(`${sectionId}_block_${index + 1}`, kind, text));
  });

  if (blocks.length === 0) {
    const fallback = root.textContent?.replace(/\s+/g, " ").trim() ?? "";
    if (fallback) {
      blocks.push(buildBlock(`${sectionId}_block_1`, "paragraph", fallback));
    }
  }

  return blocks;
}

function extractTextFromMarkup(markup: string) {
  const doc = new DOMParser().parseFromString(markup, "text/html");
  return collectEpubBlocks(doc.body ?? doc, "fallback");
}

async function parseTxtLike(file: File, format: BookFormat) {
  const text = await file.text();
  const sections = buildSectionsFromText(text, "section");
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    format,
    sections,
    fingerprint: await hashText(text)
  } satisfies ParsedBookPayload;
}

async function parseDocx(file: File) {
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const sections = buildSectionsFromText(result.value, "section");
  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    format: "docx" as const,
    sections,
    fingerprint: await hashText(result.value)
  };
}

function groupPdfItemsIntoLines(items: PdfTextItem[], viewportWidth: number) {
  const sorted = [...items]
    .filter((item) => item.str?.trim())
    .sort((a, b) => {
      const byY = b.transform[5] - a.transform[5];
      return Math.abs(byY) > 2 ? byY : a.transform[4] - b.transform[4];
    });

  const lines: Array<{
    y: number;
    items: PdfTextItem[];
  }> = [];

  for (const item of sorted) {
    const y = item.transform[5];
    const line = lines.find((entry) => Math.abs(entry.y - y) < 3.5);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y, items: [item] });
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line, index, all) => {
      const ordered = [...line.items].sort((a, b) => a.transform[4] - b.transform[4]);
      const text = ordered
        .map((item, itemIndex) => {
          const next = ordered[itemIndex + 1];
          const gap = next ? next.transform[4] - (item.transform[4] + item.width) : 0;
          const separator = gap > Math.max(item.height * 0.25, 3) ? " " : "";
          return `${item.str}${separator}`;
        })
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      const first = ordered[0];
      const indent = viewportWidth > 0 ? Math.min(first.transform[4] / viewportWidth, 0.35) : 0;
      const fontScale = first.height ? Math.min(Math.max(first.height / 14, 0.9), 1.8) : 1;
      const nextLine = all[index + 1];
      const gapY = nextLine ? Math.abs(line.y - nextLine.y) : first.height;

      return {
        text,
        indent,
        fontScale,
        breakAfter: gapY > first.height * 1.8
      };
    })
    .filter((line) => line.text);
}

async function parsePdf(file: File) {
  const pdfjsLib = await import("pdfjs-dist");
  const workerVersion = "version" in pdfjsLib ? String(pdfjsLib.version) : "5.4.54";
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${workerVersion}/build/pdf.worker.min.mjs`;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const sections: BookSection[] = [];
  const combined: string[] = [];

  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();
    const lines = groupPdfItemsIntoLines(textContent.items as PdfTextItem[], viewport.width);
    const blocks: BookBlock[] = [];
    let blockCounter = 0;

    for (const line of lines) {
      blocks.push(
        buildBlock(`page_${i}_block_${blockCounter + 1}`, "line", line.text, {
          indent: line.indent,
          fontScale: line.fontScale
        })
      );
      blockCounter += 1;

      if (line.breakAfter) {
        blockCounter += 1;
      }
    }

    const section = blocksToSection(`page_${i}`, `第 ${i} 页`, blocks);
    combined.push(section.text);
    sections.push(section);
  }

  return {
    title: file.name.replace(/\.[^.]+$/, ""),
    format: "pdf" as const,
    sections,
    fingerprint: await hashText(combined.join("\n"))
  };
}

async function parseEpub(file: File) {
  const { default: ePub } = await import("epubjs");
  const book = ePub(await file.arrayBuffer());
  await book.ready;
  await book.loaded.spine;
  const spine = (book as unknown as {
    spine?: {
      spineItems?: EpubSectionLike[];
      each?: (callback: (item: EpubSectionLike) => void) => void;
    };
  }).spine;
  const spineItems =
    spine?.spineItems?.length
      ? spine.spineItems
      : (() => {
          const items: EpubSectionLike[] = [];
          spine?.each?.((item) => items.push(item));
          return items;
        })();

  const loadedSections = await Promise.all(
    spineItems.map(async (item, index) => {
      const id = item.idref || `chapter_${index + 1}`;
      let blocks: BookBlock[] = [];

      if (typeof item.render === "function") {
        const markup = await item.render();
        blocks = extractTextFromMarkup(markup).map((block, blockIndex) => ({
          ...block,
          id: `${id}_block_${blockIndex + 1}`
        }));
      }

      if (blocks.length === 0 && typeof item.load === "function") {
        const chapter = await item.load(book.load.bind(book));
        const chapterDocument = chapter as
          | { textContent?: string; outerHTML?: string; documentElement?: { outerHTML?: string } }
          | null;
        const markup =
          typeof chapter === "string"
            ? chapter
            : chapterDocument?.outerHTML ??
              chapterDocument?.documentElement?.outerHTML ??
              "";

        blocks =
          markup.trim().length > 0
            ? extractTextFromMarkup(markup).map((block, blockIndex) => ({
                ...block,
                id: `${id}_block_${blockIndex + 1}`
              }))
            : [];

        if (blocks.length === 0) {
          const fallbackText = chapterDocument?.textContent?.replace(/\s+/g, " ").trim() ?? "";
          if (fallbackText) {
            blocks = [buildBlock(`${id}_block_1`, "paragraph", fallbackText)];
          }
        }
      }

      item.unload?.();

      return blocksToSection(id, `章节 ${index + 1}`, blocks);
    })
  );

  const metadata = await book.loaded.metadata;
  const mergedText = loadedSections.map((item) => item.text).join("\n");

  return {
    title: metadata.title || file.name.replace(/\.[^.]+$/, ""),
    author: metadata.creator || undefined,
    format: "epub" as const,
    sections: loadedSections.filter((item) => item.text),
    fingerprint: await hashText(mergedText)
  };
}

export async function parseBookFile(file: File): Promise<StoredBook> {
  const format = extensionToFormat(file.name);

  if (!format) {
    throw new Error("暂时只支持 EPUB、PDF、TXT、MD、DOCX");
  }

  const parsed =
    format === "pdf"
      ? await parsePdf(file)
      : format === "epub"
        ? await parseEpub(file)
        : format === "docx"
          ? await parseDocx(file)
          : await parseTxtLike(file, format);

  if (parsed.sections.length === 0) {
    throw new Error("这本书导入成功了，但没能解析出可阅读内容，请换一个文件再试");
  }

  return {
    id: makeId("book"),
    importedAt: new Date().toISOString(),
    ...parsed
  };
}
