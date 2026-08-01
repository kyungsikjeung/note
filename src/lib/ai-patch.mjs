/**
 * Block-ID patch schema for AI edits (MVP2).
 *
 * Pure ESM and DOM-free so the renderer, plain-node smoke tests and any future
 * main-process consumer share one implementation. Block splitting follows the
 * same conventions as lib/ksnote-markdown.cjs / lib/ksnote-store.cjs: top-level
 * elements only, no DOM, and data-block-id carries block identity.
 *
 * 완료 기준 매핑
 * - "Codex와 Claude가 동일한 Patch 응답 규격을 사용한다" -> buildPatchPrompt() 는
 *   provider 를 인자로 받지 않는다. 두 CLI 모두 이 프롬프트 한 벌만 받는다.
 * - "표 구조와 셀 서식 유지" -> opGuardError() 의 테이블 가드.
 * - "변경 전후 diff" -> diffBlocks() 가 op 단위 라인 diff 를 만든다.
 */

export const PATCH_TYPE = "ksnote-patch@1";
export const PATCH_ACTIONS = ["replace", "insert_after", "delete"];

const VOID_TAGS = new Set(["hr", "img", "br", "input", "col", "source", "area", "meta", "link"]);

const decodeEntities = (value) => String(value == null ? "" : value)
  .replace(/&nbsp;/gi, " ")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;/gi, "'")
  .replace(/&apos;/gi, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
  .replace(/&amp;/gi, "&");

const ATTRIBUTE_SCAN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

/** Value of one attribute inside a raw tag attribute string ("" when absent). */
export function attribute(attrs, name) {
  const needle = String(name || "").toLowerCase();
  ATTRIBUTE_SCAN.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE_SCAN.exec(attrs || ""))) {
    if (match[1].toLowerCase() !== needle) continue;
    return decodeEntities(match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5] || "");
  }
  return "";
}

function findCloseIndex(html, tag, from) {
  // Tag boundary without a backslash class: any attribute run must start with a non-name char.
  const pattern = new RegExp("<(/?)" + tag + "([^a-zA-Z0-9->][^>]*)?>", "gi");
  pattern.lastIndex = from;
  let depth = 1;
  let match;
  while ((match = pattern.exec(html))) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) return pattern.lastIndex;
    } else if (!/\/\s*$/.test(match[2] || "")) {
      depth += 1;
    }
  }
  return -1;
}

/** Split note HTML into top-level blocks: [{ tag, attrs, html, blockId }]. */
export function splitBlocks(html) {
  const source = String(html == null ? "" : html);
  const openTag = /<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g;
  const blocks = [];
  let cursor = 0;
  while (cursor < source.length) {
    openTag.lastIndex = cursor;
    const match = openTag.exec(source);
    if (!match) break;
    const leading = source.slice(cursor, match.index).trim();
    if (leading) blocks.push({ tag: "text", attrs: "", html: leading, blockId: "" });
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const selfClosed = VOID_TAGS.has(tag) || /\/\s*$/.test(attrs);
    let end = selfClosed ? openTag.lastIndex : findCloseIndex(source, tag, openTag.lastIndex);
    if (end < 0) end = source.length;
    blocks.push({ tag, attrs, html: source.slice(match.index, end), blockId: attribute(attrs, "data-block-id") });
    cursor = end;
  }
  const tail = source.slice(cursor).trim();
  if (tail) blocks.push({ tag: "text", attrs: "", html: tail, blockId: "" });
  return blocks;
}

let blockIdSequence = 0;

/** Unique enough within one document; ids only need to be stable, not global. */
export function newBlockId() {
  blockIdSequence = (blockIdSequence + 1) % 0xffff;
  return "b-" + Date.now().toString(36) + blockIdSequence.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Set (or replace) data-block-id on the first open tag of a block. */
export function withBlockId(html, blockId) {
  const source = String(html == null ? "" : html).trim();
  const open = /^<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/.exec(source);
  if (!open || !blockId) return source;
  const cleaned = open[2].replace(/\s*data-block-id\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  const selfClosing = /\/\s*$/.test(cleaned);
  const attrs = (selfClosing ? cleaned.replace(/\/\s*$/, "") : cleaned).replace(/\s+$/, "");
  const rebuilt = "<" + open[1] + attrs + ' data-block-id="' + blockId + '"' + (selfClosing ? " /" : "") + ">";
  return rebuilt + source.slice(open[0].length);
}

/** Assign data-block-id to every top-level element that lacks one (idempotent). */
export function ensureBlockIds(html) {
  const blocks = splitBlocks(html);
  const seen = new Set();
  let changed = false;
  const out = blocks.map((block) => {
    if (block.tag === "text") return block.html;
    if (block.blockId && !seen.has(block.blockId)) {
      seen.add(block.blockId);
      return block.html;
    }
    const id = newBlockId();
    seen.add(id);
    changed = true;
    return withBlockId(block.html, id);
  });
  return { html: out.join(""), changed };
}

const isTableBlock = (html) => /^\s*<table\b/i.test(String(html == null ? "" : html));

/** Readable plain text of one block, one logical line per row/paragraph. */
export function blockText(html) {
  const source = String(html == null ? "" : html);
  let text = source;
  if (isTableBlock(source)) {
    text = text.replace(/<p\b[^>]*>/gi, "").replace(/<\/p>/gi, " ");
    text = text.replace(/<\/t[hd]>/gi, " | ").replace(/<\/tr>/gi, "\n");
  } else {
    text = text.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6]|pre|blockquote)>/gi, "\n");
  }
  return decodeEntities(text.replace(/<[^>]+>/g, ""))
    .split("\n")
    .map((line) => line.replace(/[\t ]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .filter((line) => line !== "")
    .join("\n");
}

/** Headings of a note, used as cheap context in the prompt. */
export function outlineOf(html) {
  return splitBlocks(html)
    .filter((block) => /^h[1-6]$/.test(block.tag))
    .map((block) => ({ level: Number(block.tag.slice(1)), blockId: block.blockId, text: blockText(block.html) }));
}

/** Cheap content fingerprint (FNV-1a); only equality matters, not cryptography. */
export function hashHtml(value) {
  const text = String(value == null ? "" : value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return text.length.toString(36) + "-" + hash.toString(16);
}

/* ------------------------------------------------------------------ prompt */

const trimForPrompt = (value) => String(value == null ? "" : value).replace(/\r\n?/g, "\n").trim();

/**
 * One prompt spec for BOTH providers — Codex and Claude receive the exact same
 * text, so the response schema cannot drift between them.
 */
export function buildPatchPrompt(request) {
  const req = request || {};
  const blocks = (req.blocks || []).map((block) => (typeof block === "string" ? { html: block } : block));
  const targetSection = blocks.length
    ? blocks.map((block) => block.html).join("\n")
    : "(대상 블록 없음 — 노트 전체)";
  const outline = (req.outline || []).length
    ? req.outline.map((item) => "  ".repeat(Math.max(0, item.level - 1)) + "- " + item.text).join("\n")
    : "(제목 없음)";
  const head = req.mode === "ask"
    ? [
      "You answer questions about the supplied note. Answer in Korean, concisely.",
      "Do not use tools. Do not modify files. Do not return JSON.",
    ]
    : [
      "You are a document editor for KsNote. Return ONLY one JSON object.",
      "No prose, no explanation, no markdown code fences.",
      "",
      "RESPONSE SCHEMA (" + PATCH_TYPE + "):",
      '{"type":"' + PATCH_TYPE + '","ops":[{"blockId":"<a TARGET BLOCK id>","action":"replace|insert_after|delete","html":"<one top-level HTML block>"}],"summary":"<한 줄 요약>"}',
      "",
      "RULES:",
      "- Use only blockId values listed under TARGET BLOCKS. Never invent an id.",
      '- "html" is one top-level block element (<p>, <h2>, <ul>, <ol>, <table>, <pre>, <blockquote>, ...).',
      "- Keep the data-block-id attribute of the block you replace.",
      "- Replacing a <table> must return a <table> that keeps every <tr>/<th>/<td> and the cell formatting.",
      '- "delete" carries no html. Leave every block you were not asked to change untouched.',
      "- The whole answer must parse as JSON: escape quotes and newlines inside html.",
    ];
  return head.concat([
    "",
    "USER INSTRUCTION:",
    trimForPrompt(req.instruction),
    "",
    "TARGET: " + (req.target || "note"),
    "",
    "NOTE OUTLINE:",
    outline,
    "",
    "TARGET BLOCKS:",
    targetSection,
    "",
    "SELECTED TEXT:",
    trimForPrompt(req.selection) || "(none)",
  ]).join("\n");
}

/* ------------------------------------------------------------------ parsing */

const stripFences = (raw) => String(raw == null ? "" : raw)
  .replace(/^﻿/, "")
  .replace(/^\s*```[a-zA-Z]*\s*\n?/, "")
  .replace(/\n?```\s*$/, "")
  .trim();

/** First balanced {...} run in the text, ignoring braces inside JSON strings. */
function firstJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function validatePatch(candidate) {
  if (!candidate || typeof candidate !== "object") return "patch JSON 형식이 아닙니다.";
  if (candidate.type !== PATCH_TYPE) return "type 이 " + PATCH_TYPE + " 이 아닙니다.";
  if (!Array.isArray(candidate.ops) || !candidate.ops.length) return "ops 가 비어 있습니다.";
  for (const op of candidate.ops) {
    if (!op || typeof op !== "object") return "ops 항목이 객체가 아닙니다.";
    if (!op.blockId || typeof op.blockId !== "string") return "blockId 가 없는 op 가 있습니다.";
    if (!PATCH_ACTIONS.includes(op.action)) return "지원하지 않는 action: " + String(op.action);
    if (op.action !== "delete" && (typeof op.html !== "string" || !op.html.trim())) return "html 이 없는 " + op.action + " op 가 있습니다.";
  }
  return "";
}

/**
 * Tolerates code fences and preamble prose. Returns exactly one of:
 * { patch } · { fullHtml } (whole-note replacement fallback) · { error }.
 */
export function parsePatchResponse(rawCliOutput) {
  const text = stripFences(rawCliOutput);
  if (!text) return { error: "AI 응답이 비어 있습니다." };
  if (text.startsWith("<")) return { fullHtml: text };
  const json = firstJsonObject(text);
  if (!json) {
    if (/<[a-zA-Z][^>]*>/.test(text)) return { fullHtml: text };
    return { error: "응답에서 " + PATCH_TYPE + " JSON 을 찾지 못했습니다." };
  }
  let candidate;
  try {
    candidate = JSON.parse(json);
  } catch (error) {
    return { error: "patch JSON 을 해석하지 못했습니다: " + error.message };
  }
  const invalid = validatePatch(candidate);
  if (invalid) return { error: invalid };
  return {
    patch: {
      type: PATCH_TYPE,
      summary: typeof candidate.summary === "string" ? candidate.summary : "",
      ops: candidate.ops.map((op) => ({
        blockId: op.blockId,
        action: op.action,
        html: op.action === "delete" ? "" : String(op.html),
      })),
    },
  };
}

/* ------------------------------------------------------------------ apply */

/**
 * Structural guard for one op against the block it targets.
 * The table rule realizes the "표 구조와 셀 서식 유지" 완료 기준: a table may only
 * be replaced by a table that still carries rows.
 */
export function opGuardError(beforeHtml, op) {
  if (!op || !PATCH_ACTIONS.includes(op.action)) return "지원하지 않는 동작입니다.";
  if (op.action !== "delete" && !String(op.html || "").trim()) return "변경할 HTML 이 없습니다.";
  if (op.action === "replace" && isTableBlock(beforeHtml)) {
    if (!isTableBlock(op.html) || !/<tr\b/i.test(op.html)) return "표 구조가 유지되지 않아 적용하지 않았습니다.";
  }
  return "";
}

const readBlock = (html) => {
  const first = splitBlocks(html)[0];
  return { tag: first ? first.tag : "text", attrs: first ? first.attrs : "", html: String(html), blockId: first ? first.blockId : "" };
};

/** selected is a boolean array parallel to patch.ops; omit it to apply every op. */
function selectedOps(patch, selected) {
  const entries = ((patch && patch.ops) || []).map((op, index) => ({ op, index }));
  if (!Array.isArray(selected)) return entries;
  return entries.filter((entry) => selected[entry.index] === true);
}

/** Apply (a subset of) a patch to note HTML. Unknown ids are skipped, never guessed. */
export function applyPatchToHtml(noteHtml, patch, options) {
  const opts = options || {};
  const blocks = splitBlocks(noteHtml).map((block) => ({ ...block }));
  const skipped = [];
  let applied = 0;
  for (const entry of selectedOps(patch, opts.selected)) {
    const op = entry.op;
    const index = blocks.findIndex((block) => block.blockId && block.blockId === op.blockId);
    if (index < 0) {
      skipped.push({ blockId: op.blockId, reason: "블록을 찾지 못했습니다." });
      continue;
    }
    const guard = opGuardError(blocks[index].html, op);
    if (guard) {
      skipped.push({ blockId: op.blockId, reason: guard });
      continue;
    }
    if (op.action === "delete") blocks.splice(index, 1);
    else if (op.action === "replace") blocks[index] = readBlock(withBlockId(op.html, op.blockId));
    else blocks.splice(index + 1, 0, readBlock(withBlockId(op.html, newBlockId())));
    applied += 1;
  }
  return { html: blocks.map((block) => block.html).join(""), applied, skipped };
}

/* ------------------------------------------------------------------ diff */

const diffSplit = (value) => String(value == null ? "" : value).split("\n").filter((line) => line !== "");

/** Hand-rolled LCS line diff: [{ type: "ctx" | "del" | "add", text }]. */
export function diffLines(beforeText, afterText) {
  const before = diffSplit(beforeText);
  const after = diffSplit(afterText);
  const rows = before.length;
  const columns = after.length;
  if (!rows && !columns) return [];
  if (rows * columns > 250000) {
    return before.map((text) => ({ type: "del", text })).concat(after.map((text) => ({ type: "add", text })));
  }
  const table = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1));
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i][j] = before[i] === after[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      out.push({ type: "ctx", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ type: "del", text: before[i] });
      i += 1;
    } else {
      out.push({ type: "add", text: after[j] });
      j += 1;
    }
  }
  while (i < rows) out.push({ type: "del", text: before[i++] });
  while (j < columns) out.push({ type: "add", text: after[j++] });
  return out;
}

/**
 * Per-op diff rendered by the AI dock before anything touches the document
 * ("적용 전 실제 diff 표시" + "부분 선택 적용" 완료 기준).
 */
export function diffBlocks(noteHtml, patch) {
  const byId = new Map(splitBlocks(noteHtml).filter((block) => block.blockId).map((block) => [block.blockId, block]));
  return ((patch && patch.ops) || []).map((op, index) => {
    const target = byId.get(op.blockId) || null;
    const guard = target ? opGuardError(target.html, op) : "";
    const contextText = target ? blockText(target.html) : "";
    const beforeText = op.action === "insert_after" ? "" : contextText;
    const afterText = op.action === "delete" ? "" : blockText(op.html || "");
    return {
      index,
      blockId: op.blockId,
      action: op.action,
      missing: !target,
      error: target ? guard : "블록을 찾지 못했습니다.",
      contextText,
      beforeText,
      afterText,
      lines: diffLines(beforeText, afterText),
    };
  });
}
