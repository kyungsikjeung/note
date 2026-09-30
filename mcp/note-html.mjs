const readAttribute = (attributes, name) => {
  const match = String(attributes || "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2];
};

export const findDiagramBlock = (html, blockId) => {
  const requestedId = String(blockId || "").trim();
  if (!requestedId) return null;
  const source = String(html || "");
  const blockPattern = /<div\b([^>]*)><\/div>/gi;
  let match;
  while ((match = blockPattern.exec(source))) {
    const attributes = match[1];
    if (readAttribute(attributes, "data-block-id") !== requestedId) continue;
    const format = readAttribute(attributes, "data-type")?.toLowerCase();
    if (!["mermaid", "plantuml", "drawio"].includes(format)) return null;
    return {
      blockId: requestedId,
      format,
      code: readAttribute(attributes, "data-code") || "",
      start: match.index,
      end: blockPattern.lastIndex,
      html: match[0],
    };
  }
  return null;
};

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

export const findBlockById = (html, blockId) => {
  const requestedId = String(blockId || "").trim();
  if (!requestedId) return null;
  const source = String(html || "");
  const openPattern = new RegExp(
    `<([a-zA-Z][a-zA-Z0-9]*)\\b([^<>]*data-block-id\\s*=\\s*(["'])${escapeRegExp(requestedId)}\\3[^<>]*)>`,
    "gi",
  );
  let open;
  while ((open = openPattern.exec(source))) {
    const tag = open[1].toLowerCase();
    const start = open.index;
    const innerStart = start + open[0].length;
    if (VOID_ELEMENTS.has(tag) || /\/\s*>$/.test(open[0]))
      return { blockId: requestedId, tag, start, end: innerStart, html: open[0] };
    const tagPattern = new RegExp(`<(/?)${escapeRegExp(tag)}\\b[^<>]*?(/?)>`, "gi");
    tagPattern.lastIndex = innerStart;
    let depth = 1;
    let token;
    while ((token = tagPattern.exec(source))) {
      if (token[2]) continue;
      if (token[1]) depth -= 1;
      else depth += 1;
      if (depth === 0)
        return {
          blockId: requestedId,
          tag,
          start,
          end: tagPattern.lastIndex,
          html: source.slice(start, tagPattern.lastIndex),
        };
    }
    return null;
  }
  return null;
};

export const listEmptyDiagramBlocks = (html) => {
  const source = String(html || "");
  const blockPattern = /<div\b([^>]*)><\/div>/gi;
  const blocks = [];
  let match;
  while ((match = blockPattern.exec(source))) {
    const attributes = match[1];
    const format = readAttribute(attributes, "data-type")?.toLowerCase();
    if (!["mermaid", "plantuml", "drawio"].includes(format)) continue;
    const blockId = readAttribute(attributes, "data-block-id");
    const code = readAttribute(attributes, "data-code") || "";
    if (blockId && !code.trim()) blocks.push({ blockId, format });
  }
  return blocks;
};

const stripTags = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

export const listHeadings = (html) => {
  const source = String(html || "");
  const pattern = /<h([1-6])\b[^<>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let match;
  while ((match = pattern.exec(source))) {
    headings.push({
      level: Number(match[1]),
      text: stripTags(match[2]).slice(0, 240),
      start: match.index,
      end: pattern.lastIndex,
      html: match[0],
    });
  }
  return headings;
};

export const findHeadingSection = (html, query) => {
  const wanted = String(query || "").trim().toLowerCase();
  if (!wanted) return null;
  const source = String(html || "");
  const headings = listHeadings(source);
  const matched =
    headings.find((heading) => heading.text.toLowerCase() === wanted) ||
    headings.find((heading) => heading.text.toLowerCase().includes(wanted));
  if (!matched) return null;
  const position = headings.indexOf(matched);
  const closer = headings
    .slice(position + 1)
    .find((heading) => heading.level <= matched.level);
  const end = closer ? closer.start : source.length;
  const section = source.slice(matched.start, end);
  return {
    heading: matched.text,
    level: matched.level,
    start: matched.start,
    end,
    html: section,
    text: stripTags(section).slice(0, 8000),
  };
};

export const sliceTextLines = (text, fromLine, toLine) => {
  const lines = String(text || "").split("\n");
  const total = lines.length;
  const from = Math.min(Math.max(1, Math.floor(Number(fromLine) || 1)), total);
  const to = Math.min(Math.max(from, Math.floor(Number(toLine) || total)), total);
  return {
    fromLine: from,
    toLine: to,
    totalLines: total,
    text: lines.slice(from - 1, to).join("\n"),
  };
};

export const listTaskItems = (html) => {
  const source = String(html || "");
  const openPattern = /<li\b([^<>]*)>/gi;
  const tasks = [];
  let open;
  while ((open = openPattern.exec(source))) {
    const attributes = open[1];
    if (readAttribute(attributes, "data-type") !== "taskItem") {
      if (!/\bdata-checked\s*=/i.test(attributes)) continue;
    }
    const innerStart = open.index + open[0].length;
    const tagPattern = /<(\/?)li\b[^<>]*?(\/?)>/gi;
    tagPattern.lastIndex = innerStart;
    let depth = 1;
    let token;
    let end = -1;
    while ((token = tagPattern.exec(source))) {
      if (token[2]) continue;
      if (token[1]) depth -= 1;
      else depth += 1;
      if (depth === 0) {
        end = tagPattern.lastIndex;
        break;
      }
    }
    if (end < 0) continue;
    const inner = source.slice(innerStart, end - "</li>".length);
    tasks.push({
      index: tasks.length,
      checked: readAttribute(attributes, "data-checked") === "true",
      dueDate: readAttribute(attributes, "data-due-date") || "",
      assignee: readAttribute(attributes, "data-assignee") || "",
      priority: readAttribute(attributes, "data-priority") || "normal",
      text: stripTags(inner).slice(0, 240),
      start: open.index,
      end,
    });
  }
  return tasks;
};
