"use strict";

/**
 * Markdown <-> KsNote HTML helpers plus a line diff.
 * Dependency-free and free of store imports so the Electron main process,
 * the MCP server (via createRequire) and tests can all share one implementation.
 */

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

const escapeHtml = (value) => String(value == null ? "" : value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const ATTRIBUTE_SCAN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

/** Value of one attribute inside a raw tag attribute string ("" when absent). */
const attribute = (attrs, name) => {
  const needle = String(name || "").toLowerCase();
  ATTRIBUTE_SCAN.lastIndex = 0;
  let match;
  while ((match = ATTRIBUTE_SCAN.exec(attrs || ""))) {
    if (match[1].toLowerCase() !== needle) continue;
    return decodeEntities(match[3] !== undefined ? match[3] : match[4] !== undefined ? match[4] : match[5] || "");
  }
  return "";
};

const PIPE_ESCAPE = String.fromCharCode(92) + "|";

const splitLines = (value) => {
  const lines = String(value == null ? "" : value).replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
};

/* ------------------------------------------------------------------ html -> markdown */

function inlineToMarkdown(html) {
  let out = String(html == null ? "" : html);
  out = out.replace(/<br\s*\/?>/gi, "\n");
  out = out.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => "**" + inlineToMarkdown(inner) + "**");
  out = out.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => "*" + inlineToMarkdown(inner) + "*");
  out = out.replace(/<(s|del|strike)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner) => "~~" + inlineToMarkdown(inner) + "~~");
  out = out.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, inner) => "`" + decodeEntities(inner.replace(/<[^>]+>/g, "")) + "`");
  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => "[" + inlineToMarkdown(inner) + "](" + attribute(attrs, "href") + ")");
  out = out.replace(/<img\b([^>]*?)\/?>/gi, (_, attrs) => "![" + attribute(attrs, "alt") + "](" + attribute(attrs, "src") + ")");
  return decodeEntities(out.replace(/<[^>]+>/g, "")).replace(/[ \t ]+/g, " ").trim();
}

/** Top-level <li> items of a list, tolerant of nested lists. */
function listItems(html) {
  const items = [];
  const pattern = /<(\/?)li\b([^>]*)>/gi;
  let depth = 0;
  let start = -1;
  let startAttrs = "";
  let match;
  while ((match = pattern.exec(html))) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0 && start >= 0) items.push({ attrs: startAttrs, html: html.slice(start, match.index) });
    } else {
      if (depth === 0) {
        start = pattern.lastIndex;
        startAttrs = match[2] || "";
      }
      depth += 1;
    }
  }
  return items;
}

function listToMarkdown(html, ordered, indent) {
  const pad = " ".repeat(indent || 0);
  return listItems(html).map((item, index) => {
    const nested = /<(ul|ol)\b[\s\S]*<\/\1>/i.exec(item.html);
    const body = nested ? item.html.slice(0, nested.index) + item.html.slice(nested.index + nested[0].length) : item.html;
    const checkedAttr = attribute(item.attrs, "data-checked");
    const isTask = attribute(item.attrs, "data-type") === "taskItem" || checkedAttr !== "" || /<input\b[^>]*type\s*=\s*["']?checkbox/i.test(body);
    const checked = checkedAttr ? checkedAttr === "true" : /<input\b[^>]*\bchecked\b/i.test(body);
    const marker = isTask ? "- [" + (checked ? "x" : " ") + "] " : ordered ? index + 1 + ". " : "- ";
    const line = pad + marker + inlineToMarkdown(body.replace(/<input\b[^>]*>/gi, ""));
    if (!nested) return line;
    const sublist = listToMarkdown(nested[0], /^<ol\b/i.test(nested[0]), (indent || 0) + 2);
    return sublist ? line + "\n" + sublist : line;
  }).join("\n");
}

function codeBlockToMarkdown(inner) {
  const codeMatch = /<code\b([^>]*)>([\s\S]*?)<\/code>/i.exec(inner);
  const attrs = codeMatch ? codeMatch[1] : "";
  const raw = codeMatch ? codeMatch[2] : inner;
  const body = decodeEntities(raw.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
  const language = (/language-([\w+#-]+)/i.exec(attribute(attrs, "class")) || [])[1] || attribute(attrs, "data-language") || "";
  return "```" + language + "\n" + body + "\n```";
}

function tableToMarkdown(inner) {
  const rows = Array.from(inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)).map((row) =>
    Array.from(row[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)).map((cell) => inlineToMarkdown(cell[1]).replace(/\|/g, PIPE_ESCAPE)),
  );
  if (!rows.length) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const render = (cells) => "| " + Array.from({ length: width }, (_, index) => cells[index] || "").join(" | ") + " |";
  return [render(rows[0]), "| " + Array.from({ length: width }, () => "---").join(" | ") + " |"]
    .concat(rows.slice(1).map(render))
    .join("\n");
}

/** One top-level block of note HTML rendered as markdown. */
function blockToMarkdown(html) {
  const source = String(html == null ? "" : html).trim();
  if (!source) return "";
  const open = /^<([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/.exec(source);
  if (!open) return decodeEntities(source.replace(/<[^>]+>/g, "")).trim();
  const tag = open[1].toLowerCase();
  const attrs = open[2] || "";
  const trimmed = source.replace(/\s+$/, "");
  const closing = "</" + tag + ">";
  const inner = trimmed.toLowerCase().endsWith(closing)
    ? trimmed.slice(open[0].length, trimmed.length - closing.length)
    : trimmed.slice(open[0].length);
  const dataType = attribute(attrs, "data-type");
  if (dataType === "mermaid" || dataType === "plantuml") return "```" + dataType + "\n" + attribute(attrs, "data-code") + "\n```";
  if (dataType === "attachment") return "[" + (attribute(attrs, "name") || "attachment") + "](" + attribute(attrs, "src") + ")";
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) return "#".repeat(Number(heading[1])) + " " + inlineToMarkdown(inner);
  if (tag === "hr") return "---";
  if (tag === "img") return "![" + attribute(attrs, "alt") + "](" + attribute(attrs, "src") + ")";
  if (tag === "pre") return codeBlockToMarkdown(inner);
  if (tag === "table") return tableToMarkdown(inner);
  if (tag === "ul" || tag === "ol") return listToMarkdown(source, tag === "ol", 0);
  if (tag === "blockquote") {
    const text = inner.replace(/<\/p>/gi, "\n").replace(/<p\b[^>]*>/gi, "");
    return inlineToMarkdown(text).split("\n").map((line) => "> " + line).join("\n");
  }
  return inlineToMarkdown(inner);
}

/** Block rows (from the store) or raw HTML strings rendered as one markdown document. */
function blocksToMarkdown(blocks) {
  return (blocks || [])
    .map((block) => blockToMarkdown(typeof block === "string" ? block : block.html))
    .filter((text) => text !== "")
    .join("\n\n");
}

/* ------------------------------------------------------------------ markdown -> html */

function inlineToHtml(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, code) => "<code>" + code + "</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<s>$1</s>");
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  return out;
}

const TASK_LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
const BULLET_LINE = /^\s*[-*+]\s+(.*)$/;
const ORDERED_LINE = /^\s*\d+[.)]\s+(.*)$/;

/**
 * Minimal markdown -> KsNote HTML covering what the MCP write tools accept:
 * headings, paragraphs, task/bullet/ordered lists, fenced code (incl. mermaid/plantuml),
 * blockquotes, rules and GFM tables.
 */
function markdownToHtml(markdown) {
  const lines = splitLines(markdown);
  const out = [];
  let index = 0;
  const collect = (matcher, render) => {
    const items = [];
    while (index < lines.length) {
      const match = matcher.exec(lines[index]);
      if (!match) break;
      items.push(match);
      index += 1;
    }
    out.push(render(items));
  };
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = /^```([\w+#-]*)\s*$/.exec(line.trim());
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) body.push(lines[index++]);
      index += 1;
      const language = fence[1].toLowerCase();
      if (language === "mermaid" || language === "plantuml") {
        out.push('<div data-type="' + language + '" data-code="' + escapeHtml(body.join("\n")).replace(/\n/g, "&#10;") + '"></div>');
      } else {
        out.push("<pre><code" + (language ? ' class="language-' + language + '"' : "") + ">" + escapeHtml(body.join("\n")) + "</code></pre>");
      }
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      out.push("<h" + heading[1].length + ">" + inlineToHtml(heading[2].trim()) + "</h" + heading[1].length + ">");
      index += 1;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      index += 1;
      continue;
    }
    if (TASK_LINE.test(line)) {
      collect(TASK_LINE, (items) =>
        '<ul data-type="taskList">' +
        items.map((item) => {
          const checked = item[1].toLowerCase() === "x";
          return '<li data-type="taskItem" data-checked="' + checked + '"><label><input type="checkbox"' + (checked ? " checked" : "") + "></label><div><p>" + inlineToHtml(item[2].trim()) + "</p></div></li>";
        }).join("") +
        "</ul>",
      );
      continue;
    }
    if (BULLET_LINE.test(line)) {
      collect(BULLET_LINE, (items) => "<ul>" + items.map((item) => "<li><p>" + inlineToHtml(item[1].trim()) + "</p></li>").join("") + "</ul>");
      continue;
    }
    if (ORDERED_LINE.test(line)) {
      collect(ORDERED_LINE, (items) => "<ol>" + items.map((item) => "<li><p>" + inlineToHtml(item[1].trim()) + "</p></li>").join("") + "</ol>");
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      out.push("<blockquote><p>" + quote.map((text) => inlineToHtml(text)).join("<br>") + "</p></blockquote>");
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      const rows = [];
      while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
        const cells = lines[index].trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-{2,}:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      if (rows.length) {
        const header = "<tr>" + rows[0].map((cell) => "<th><p>" + inlineToHtml(cell) + "</p></th>").join("") + "</tr>";
        const body = rows.slice(1).map((row) => "<tr>" + row.map((cell) => "<td><p>" + inlineToHtml(cell) + "</p></td>").join("") + "</tr>").join("");
        out.push("<table><tbody>" + header + body + "</tbody></table>");
      }
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,6}\s|```|\s*>|\s*\||\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[index])) paragraph.push(lines[index++]);
    out.push("<p>" + paragraph.map((text) => inlineToHtml(text.trim())).join("<br>") + "</p>");
  }
  return out.join("");
}

/* ------------------------------------------------------------------ diff */

/** LCS line diff: [{ sign: " " | "-" | "+", text }]. */
function diffLines(beforeText, afterText) {
  const before = splitLines(beforeText);
  const after = splitLines(afterText);
  if (before.length * after.length > 250000) {
    return before.map((text) => ({ sign: "-", text })).concat(after.map((text) => ({ sign: "+", text })));
  }
  const rows = before.length;
  const columns = after.length;
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
      out.push({ sign: " ", text: before[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ sign: "-", text: before[i] });
      i += 1;
    } else {
      out.push({ sign: "+", text: after[j] });
      j += 1;
    }
  }
  while (i < rows) out.push({ sign: "-", text: before[i++] });
  while (j < columns) out.push({ sign: "+", text: after[j++] });
  return out;
}

/** Unified-style text diff used as the human readable preview of a pending write. */
function unifiedDiff(beforeText, afterText, options) {
  const opts = options || {};
  const lines = diffLines(beforeText, afterText).map((line) => line.sign + line.text);
  return ["--- " + (opts.from || "현재"), "+++ " + (opts.to || "변경 후")].concat(lines).join("\n");
}

/** Diff of a document that only gains lines (used by note_create). */
function additionDiff(afterText, options) {
  return unifiedDiff("", afterText, options);
}

module.exports = {
  attribute,
  escapeHtml,
  decodeEntities,
  inlineToMarkdown,
  blockToMarkdown,
  blocksToMarkdown,
  markdownToHtml,
  diffLines,
  unifiedDiff,
  additionDiff,
  splitLines,
};
