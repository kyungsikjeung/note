const TABLE_MIN_WIDTH = 144;
const TABLE_MAX_WIDTH = 1800;

const decodeEntities = (value) =>
  String(value || "")
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const readAttribute = (attributes, name) => {
  const match = String(attributes || "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2];
};

const fnvHash = (value) => {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv:${(hash >>> 0).toString(16)}`;
};

const warn = (warnings, code, message) => {
  if (!warnings.some((entry) => entry.code === code && entry.message === message))
    warnings.push({ code, message });
};

const scanTopLevelBlocks = (html) => {
  const source = String(html || "");
  const blocks = [];
  const pattern = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)(\/?)>/g;
  let match;
  let current = null;
  let lastIndex = 0;
  while ((match = pattern.exec(source))) {
    const [full, closing, tagName, attributes, selfClosing] = match;
    if (current) current.raw += source.slice(lastIndex, match.index) + full;
    lastIndex = match.index + full.length;
    const tag = tagName.toLowerCase();
    if (current) {
      if (!closing && !selfClosing && tag === current.tag) current.depth += 1;
      if (closing && tag === current.tag) {
        current.depth -= 1;
        if (current.depth === 0) {
          blocks.push(current);
          current = null;
        }
      }
      continue;
    }
    if (closing) continue;
    if (selfClosing || ["br", "hr", "img", "col"].includes(tag)) {
      blocks.push({ tag, attributes, raw: full, selfClosing: true });
      continue;
    }
    current = { tag, attributes, raw: full, depth: 1 };
  }
  if (current) blocks.push(current);
  return blocks;
};

const parseInline = (html, warnings) => {
  const source = String(html || "");
  const nodes = [];
  let text = "";
  const marks = [];
  const flush = () => {
    if (!text) return;
    const node = { type: "text", text };
    if (marks.length) node.marks = marks.map((mark) => ({ ...mark }));
    nodes.push(node);
    text = "";
  };
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^<>]*)>/g;
  let lastIndex = 0;
  let match;
  while ((match = pattern.exec(source))) {
    text += decodeEntities(source.slice(lastIndex, match.index));
    lastIndex = match.index + match[0].length;
    const closing = match[0].startsWith("</");
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    if (tag === "br" && !closing) {
      flush();
      nodes.push({ type: "hardBreak" });
      continue;
    }
    const markFor = () => {
      if (tag === "strong" || tag === "b") return { type: "strong" };
      if (tag === "em" || tag === "i") return { type: "em" };
      if (tag === "u") return { type: "underline" };
      if (tag === "s" || tag === "strike" || tag === "del") return { type: "strike" };
      if (tag === "code") return { type: "code" };
      if (tag === "a") {
        const href = readAttribute(attributes, "href");
        return href ? { type: "link", attrs: { href } } : null;
      }
      return null;
    };
    if (!closing) {
      const mark = markFor();
      if (mark) {
        flush();
        marks.push(mark);
      }
      else if (!["span"].includes(tag)) warn(warnings, "inline-style-dropped", `<${tag}> 인라인 서식은 Confluence에서 유지되지 않을 수 있습니다.`);
    } else {
      const mark = markFor();
      if (mark) {
        const at = marks.map((entry) => entry.type).lastIndexOf(mark.type);
        if (at >= 0) {
          flush();
          marks.splice(at, 1);
        }
      }
    }
  }
  text += decodeEntities(source.slice(lastIndex));
  flush();
  return nodes.length ? nodes : [{ type: "text", text: "" }];
};

const inlineText = (html) =>
  parseInline(html, [])
    .filter((node) => node.type === "text")
    .map((node) => node.text)
    .join("");

const parseListItems = (inner, warnings) => {
  const items = [];
  const pattern = /<(\/?)li\b([^<>]*)(\/?)>/gi;
  let match;
  let current = null;
  let lastIndex = 0;
  while ((match = pattern.exec(inner))) {
    const [full, closing, attributes, selfClosing] = match;
    if (current) current.raw += inner.slice(lastIndex, match.index) + full;
    lastIndex = match.index + full.length;
    if (current) {
      if (!closing && !selfClosing) current.depth += 1;
      if (closing) {
        current.depth -= 1;
        if (current.depth === 0) {
          items.push(current);
          current = null;
        }
      }
      continue;
    }
    if (closing || selfClosing) continue;
    current = { attributes, raw: full, depth: 1, checked: readAttribute(attributes, "data-checked") };
  }
  if (current) items.push(current);
  return items.map((item) => ({
    checked: item.checked,
    content: item.raw.replace(/<\/li\s*>$/i, ""),
  }));
};

const pxWidths = (colgroupHtml, count) => {
  const found = [];
  const pattern = /<col\b[^<>]*>/gi;
  let match;
  while ((match = pattern.exec(String(colgroupHtml || "")))) {
    const style = readAttribute(match[0].replace(/^<col/i, "<x").replace(/>$/, ""), "style") || match[0];
    const width = /width\s*:\s*(\d+)\s*px/i.exec(style || "");
    found.push(width ? Number(width[1]) : null);
  }
  while (found.length < count) found.push(null);
  return found.slice(0, count);
};

const convertTable = (tableHtml, attributes, target, warnings) => {
  const rows = [];
  const rowPattern = /<tr\b[^<>]*>([\s\S]*?)<\/tr\s*>/gi;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(tableHtml))) {
    const cells = [];
    const cellPattern = /<(th|td)\b([^<>]*)>([\s\S]*?)<\/\1\s*>/gi;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const [, cellTag, cellAttributes, cellInner] = cellMatch;
      const colspan = Math.max(1, Number(readAttribute(cellAttributes, "colspan")) || 1);
      const rowspan = Math.max(1, Number(readAttribute(cellAttributes, "rowspan")) || 1);
      const background = readAttribute(cellAttributes, "data-background") ||
        /background(?:-color)?\s*:\s*([^;]+)/i.exec(readAttribute(cellAttributes, "style") || "")?.[1]?.trim();
      const cell = {
        type: cellTag.toLowerCase() === "th" ? "tableHeader" : "tableCell",
        content: [
          {
            type: "paragraph",
            content: parseInline(cellInner, warnings),
          },
        ],
      };
      const cellAttributesOut = {};
      if (colspan > 1) cellAttributesOut.colspan = colspan;
      if (rowspan > 1) cellAttributesOut.rowspan = rowspan;
      if (background) cellAttributesOut.background = background;
      if (Object.keys(cellAttributesOut).length) cell.attrs = cellAttributesOut;
      cells.push({ node: cell, colspan });
    }
    if (cells.length) rows.push(cells.map((cell) => cell.node));
  }
  if (!rows.length) {
    warn(warnings, "empty-table-dropped", "빈 표는 게시에서 제외했습니다.");
    return null;
  }
  const columnCount = Math.max(...rows.map((row) => row.length));
  const colgroup = /<colgroup\b[^<>]*>([\s\S]*?)<\/colgroup\s*>/i.exec(tableHtml)?.[1] || "";
  const rawWidths = pxWidths(colgroup, columnCount);
  const known = rawWidths.filter((width) => width);
  const fallback = known.length
    ? Math.round(known.reduce((sum, width) => sum + width, 0) / known.length)
    : 120;
  const widths = rawWidths.map((width) => width || fallback);
  const total = widths.reduce((sum, width) => sum + width, 0);
  const clampedTotal = Math.min(TABLE_MAX_WIDTH, Math.max(TABLE_MIN_WIDTH, total));
  if (clampedTotal !== total)
    warn(warnings, "table-width-clamped", `표 전체 너비를 ${total}px에서 ${clampedTotal}px로 조정했습니다.`);
  if (target === "jira")
    warn(warnings, "table-width-jira", "Jira에서는 표가 전체 폭으로 표시되어 Confluence와 폭이 다를 수 있습니다.");
  const scaled = widths.map((width) => Math.max(1, Math.round((width / total) * clampedTotal)));
  let columnIndex = 0;
  for (const row of rows) {
    for (const cell of row) {
      const span = cell.attrs?.colspan || 1;
      const slice = scaled.slice(columnIndex, columnIndex + span);
      cell.attrs = { ...(cell.attrs || {}), colwidth: slice };
      columnIndex += span;
    }
    columnIndex = 0;
  }
  return {
    type: "table",
    attrs: { width: clampedTotal },
    content: rows.map((cells) => ({ type: "tableRow", content: cells })),
  };
};

const convertBlocks = (html, target, warnings, omittedAssets, taskCounter) => {
  const content = [];
  for (const block of scanTopLevelBlocks(html)) {
    const { tag, attributes, raw, selfClosing } = block;
    if (/^h[1-6]$/.test(tag)) {
      const text = inlineText(raw.replace(new RegExp(`^<${tag}\\b[^<>]*>`, "i"), "").replace(new RegExp(`</${tag}\\s*>$`, "i"), ""));
      content.push({
        type: "heading",
        attrs: { level: Number(tag[1]) },
        content: [{ type: "text", text: text || " " }],
      });
      continue;
    }
    if (tag === "p") {
      const inner = raw.replace(/^<p\b[^<>]*>/i, "").replace(/<\/p\s*>$/i, "");
      const images = [...inner.matchAll(/<img\b([^<>]*)>/gi)];
      if (images.length && inlineText(inner) === "") {
        for (const image of images) content.push(convertImage(image[1], warnings, omittedAssets));
        continue;
      }
      content.push({ type: "paragraph", content: parseInline(inner, warnings) });
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      const inner = raw.replace(new RegExp(`^<${tag}\\b[^<>]*>`, "i"), "").replace(new RegExp(`</${tag}\\s*>$`, "i"), "");
      const listItems = parseListItems(inner, warnings);
      const ordered = tag === "ol";
      content.push({
        type: ordered ? "orderedList" : "bulletList",
        content: listItems.map((item) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: parseInline(item.content, warnings) }],
        })),
      });
      continue;
    }
    if (tag === "blockquote") {
      const inner = raw.replace(/^<blockquote\b[^<>]*>/i, "").replace(/<\/blockquote\s*>$/i, "");
      content.push({ type: "blockquote", content: convertBlocks(inner, target, warnings, omittedAssets, taskCounter) });
      continue;
    }
    if (tag === "pre") {
      const codeMatch = /<code\b([^<>]*)>([\s\S]*?)<\/code\s*>/i.exec(raw);
      const language = codeMatch
        ? /language-([\w+-]+)/i.exec(readAttribute(codeMatch[1], "class") || "")?.[1] || ""
        : "";
      const code = decodeEntities(codeMatch ? codeMatch[2] : raw).replace(/<[^>]+>/g, "");
      const node = { type: "codeBlock", content: [{ type: "text", text: code || " " }] };
      if (language) node.attrs = { language };
      content.push(node);
      continue;
    }
    if (tag === "table") {
      const table = convertTable(raw, attributes, target, warnings);
      if (table) content.push(table);
      continue;
    }
    if (tag === "hr") {
      content.push({ type: "rule" });
      continue;
    }
    if (tag === "img") {
      content.push(convertImage(attributes, warnings, omittedAssets));
      continue;
    }
    if (tag === "div") {
      const dataType = (readAttribute(attributes, "data-type") || "").toLowerCase();
      if (["mermaid", "plantuml", "drawio"].includes(dataType)) {
        const code = decodeEntities(readAttribute(attributes, "data-code") || "");
        content.push({
          type: "codeBlock",
          attrs: { language: dataType === "drawio" ? "xml" : dataType },
          content: [{ type: "text", text: code || " " }],
        });
        continue;
      }
      const text = inlineText(raw);
      if (text) {
        warn(warnings, "unsupported-block-flattened", `<div> 블록을 일반 문단으로 변환했습니다.`);
        content.push({ type: "paragraph", content: [{ type: "text", text }] });
      }
      continue;
    }
    if (selfClosing) continue;
    const text = inlineText(raw);
    if (text) {
      warn(warnings, "unsupported-block-flattened", `<${tag}> 블록을 일반 문단으로 변환했습니다.`);
      content.push({ type: "paragraph", content: [{ type: "text", text }] });
    }
  }
  return content;
};

const convertImage = (attributes, warnings, omittedAssets) => {
  const src = readAttribute(attributes, "src") || "";
  const alt = readAttribute(attributes, "alt") || "";
  if (/^https:\/\//i.test(src)) {
    warn(warnings, "image-reference", `외부 이미지(${src.slice(0, 80)})는 카드 링크로 변환됩니다.`);
    return { type: "blockCard", attrs: { url: src } };
  }
  omittedAssets.push({ src: src || alt || "(unknown)", reason: "로컬·file·data 이미지는 업로드 도구가 없어 제외했습니다." });
  warn(warnings, "image-omitted", "로컬 이미지는 게시에서 제외했습니다. 누락 목록을 확인하세요.");
  return { type: "paragraph", content: [{ type: "text", text: alt ? `[이미지 제외: ${alt}]` : "[이미지 제외]" }] };
};

export const convertNoteToAdf = (html, { target = "confluence", sourceRevision = "" } = {}) => {
  const warnings = [];
  const omittedAssets = [];
  const taskCounter = { value: 0 };
  const content = convertBlocks(html, target, warnings, omittedAssets, taskCounter);
  const document = { version: 1, type: "doc", content };
  return {
    document,
    warnings,
    omittedAssets,
    sourceRevision: String(sourceRevision || ""),
    contentHash: fnvHash(JSON.stringify(document)),
  };
};

export const validateAdf = (document) => {
  if (!document || document.version !== 1 || document.type !== "doc" || !Array.isArray(document.content))
    return { ok: false, code: "adf_root_invalid", message: "ADF 최상위는 version 1 doc이어야 합니다." };
  const stack = [...document.content];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string")
      return { ok: false, code: "adf_node_invalid", message: "ADF 노드에 type이 필요합니다." };
    if (node.text !== undefined && typeof node.text !== "string")
      return { ok: false, code: "adf_text_invalid", message: "ADF text는 문자열이어야 합니다." };
    if (node.content !== undefined && !Array.isArray(node.content))
      return { ok: false, code: "adf_content_invalid", message: "ADF content는 배열이어야 합니다." };
    if (Array.isArray(node.content)) stack.push(...node.content);
    if (node.type === "table") {
      const width = node.attrs?.width;
      if (width !== undefined && (width < TABLE_MIN_WIDTH || width > TABLE_MAX_WIDTH))
        return { ok: false, code: "adf_table_width_invalid", message: `표 너비는 ${TABLE_MIN_WIDTH}~${TABLE_MAX_WIDTH}px여야 합니다.` };
    }
  }
  return { ok: true };
};
