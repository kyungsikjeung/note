/**
 * KsNote 변환기 라이브러리 (converters.mjs)
 * =========================================
 * 순수 문자열 처리 ESM 모듈 — Electron·DOM 런타임 의존 없음. 렌더러(브라우저)와
 * Node(메인 프로세스 / CLI / MCP 서버) 양쪽에서 동일하게 import 된다.
 * turndown 은 Node 에서 번들 파서(@mixmark-io/domino)를 쓰므로 DOM 주입이 필요 없다(실측 확인).
 *
 * 노트 본문의 정본은 TipTap 이 만든 rich HTML 이고, 이 모듈은 그것을 Markdown 과
 * 외부 플랫폼 포맷(Jira / Confluence / GitHub)으로 오간다.
 *
 * ## ks 속성 주석 규약
 * Markdown 에 표현할 자리가 없는 KsNote 고유 속성은 바로 앞 요소에 붙는 HTML 주석으로 보존한다.
 *
 *   <!--ks:{"t":"img","width":"320px","align":"right","caption":"…","assetPath":"…"}-->
 *   <!--ks:{"t":"task","due":"2026-08-02","assignee":"kim","priority":"high"}-->
 *   <!--ks:{"t":"attach","size":20480,"assetPath":"…"}-->
 *
 * `t` 는 판별자다. 주석은 markdownToRich() 가 다시 속성으로 복원하고,
 * markdownToGithub()/Jira/Confluence 는 외부 플랫폼에 의미가 없으므로 제거한다.
 *
 * ## 무손실 왕복 보장 범위 (richToMarkdown ↔ markdownToRich)
 * 제목 1~6 · 문단 · 굵게/기울임/밑줄/취소선 · 링크 · 글머리·번호 목록(중첩 포함) ·
 * 체크리스트(checked + due/assignee/priority) · 인용 · 구분선 · 언어 지정 코드블록 ·
 * GFM 표 · 이미지(width/align/caption/assetPath) · mermaid/plantuml 블록 · 첨부 블록.
 *
 * ## 의도적으로 수용한 손실 (lossy — 설계상 복원하지 않음)
 * 1. 글자색·형광펜(TipTap Color/Highlight)과 문단 정렬(TextAlign)은 Markdown 에 대응이 없어
 *    richToMarkdown 에서 사라진다. 서식이 아니라 의미를 옮기는 것이 이 모듈의 목적이라 ks 주석으로도
 *    보존하지 않는다 — 보존하면 모든 문단에 주석이 붙어 Markdown 가독성이 무너진다.
 * 2. 표의 병합 셀(colspan/rowspan)은 GFM·Jira 어디에도 없다. convertTable() 이 colspan 을
 *    같은 값의 셀 반복으로 펼치고 note 로 알린다. rowspan 은 첫 행에만 값을 남기고 나머지는 빈 셀.
 * 3. 표 셀 안의 블록 요소(목록·코드블록·중첩 표)는 인라인으로 눌린다. 셀 내 줄바꿈은
 *    타깃별 표기(GFM `<br>`, Jira `\`, Confluence `<br />`)로 치환한다.
 * 4. 제목 행이 없는 표는 GFM 문법상 표현 불가라 첫 행을 제목 행으로 승격한다.
 * 5. Confluence·Jira 에는 mermaid/plantuml 네이티브 렌더링이 없어 해당 언어의 코드블록으로 내려간다.
 * 6. 첨부 블록은 Markdown 에서 링크 + ks 주석이다. 주석이 없는 순수 Markdown 을 가져오면
 *    일반 링크가 되고 첨부 블록으로 승격되지 않는다(정보가 없으므로 복원 불가).
 * 7. Jira 는 6단계 제목까지만 대응된다(h1.~h6.) — 그 이상은 애초에 Markdown 에도 없다.
 * 8. TipTap 체크리스트 마감일 속성의 실제 DOM 이름은 `data-due-date` 다(`data-due` 아님).
 *    읽을 때는 둘 다 허용하고, 쓸 때는 에디터 정본인 `data-due-date` 로 낸다.
 * 9. 같은 종류의 목록 두 개가 빈 줄 하나로만 떨어져 있으면 CommonMark 가 하나로 합친다.
 *    체크리스트(`*`)와 일반 목록(`-`)은 마커를 달리해 분리를 보장하지만,
 *    일반 목록 두 개가 연달아 오는 경우는 Markdown 문법상 구분할 방법이 없어 병합된다.
 */

import { Marked } from "marked";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const KS_COMMENT_RE = /<!--ks:(\{[\s\S]*?\})-->/;
const KS_COMMENT_RE_G = /<!--ks:(\{[\s\S]*?\})-->/g;
const DIAGRAM_TYPES = ["mermaid", "plantuml"];

/* ─────────────────────────── 공통 유틸 ─────────────────────────── */

const escapeAttribute = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");

const escapeXml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const decodeEntities = (value) =>
  String(value ?? "")
    .replace(/&#10;/g, "\n")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** ks 주석 JSON 을 만든다. 값이 비어 있는 키는 넣지 않아 왕복 시 잡음이 생기지 않게 한다. */
const ksComment = (type, attrs) => {
  const payload = { t: type };
  let hasAny = false;
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === "" || value === 0) continue;
    payload[key] = value;
    hasAny = true;
  }
  if (!hasAny && type !== "attach") return "";
  return `<!--ks:${JSON.stringify(payload)}-->`;
};

const parseKs = (raw) => {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

/** 텍스트에서 ks 주석을 떼어내 { text, ks } 로 나눈다. */
const splitKs = (text) => {
  const source = String(text ?? "");
  const match = source.match(KS_COMMENT_RE);
  if (!match) return { text: source, ks: null };
  return {
    text: source.replace(KS_COMMENT_RE_G, "").replace(/[ \t]+$/, ""),
    ks: parseKs(match[1]),
  };
};

const stripKsComments = (text) => String(text ?? "").replace(KS_COMMENT_RE_G, "").replace(/[ \t]+$/gm, "");

/* ───────────────────── rich HTML → Markdown ───────────────────── */

/**
 * 체크리스트는 `*`, 일반 글머리 목록은 `-` 로 낸다.
 * 마커가 같으면 CommonMark 가 인접한 두 목록을 하나로 합쳐버려
 * "체크리스트 다음에 오는 일반 목록"이 왕복에서 체크리스트로 흡수된다.
 */
const BULLET_MARKER = "-";
const TASK_MARKER = "*";

const attr = (node, ...names) => {
  for (const name of names) {
    const value = node.getAttribute ? node.getAttribute(name) : null;
    if (value) return value;
  }
  return "";
};

const isTaskItem = (node) =>
  node.nodeName === "LI" &&
  (node.getAttribute?.("data-checked") !== null ||
    node.parentNode?.getAttribute?.("data-type") === "taskList");

const hasTaskItemAncestor = (node) => {
  let cursor = node.parentNode;
  while (cursor) {
    if (cursor.nodeName === "LI" && isTaskItem(cursor)) return true;
    cursor = cursor.parentNode;
  }
  return false;
};

const isDiagramNode = (node) =>
  node.nodeName === "DIV" && DIAGRAM_TYPES.includes(attr(node, "data-type"));

const isAttachmentNode = (node) =>
  node.nodeName === "DIV" && attr(node, "data-type") === "attachment";

/** 이미지 style="width:320px" 에서 폭만 뽑는다. */
const widthOf = (node) => {
  const explicit = attr(node, "width");
  if (explicit && explicit !== "auto") return explicit;
  const style = attr(node, "style");
  const match = style.match(/width\s*:\s*([^;]+)/i);
  const value = match ? match[1].trim() : "";
  return value && value !== "auto" ? value : "";
};

const diagramToFence = (node) => {
  const type = attr(node, "data-type");
  const code = decodeEntities(attr(node, "data-code")).trim();
  return `\n\n\`\`\`${type}\n${code}\n\`\`\`\n\n`;
};

const attachmentToLink = (node) => {
  const name = attr(node, "name") || "첨부파일";
  const src = attr(node, "src");
  const marker = ksComment("attach", {
    size: Number(attr(node, "size")) || 0,
    assetPath: attr(node, "data-asset-path", "assetPath"),
  });
  return `\n\n[${name}](${src})${marker}\n\n`;
};

const createTurndown = () => {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: BULLET_MARKER,
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
    linkStyle: "inlined",
    // mermaid/plantuml/첨부 블록은 자식이 없는 빈 div 라 turndown 의 blank 판정에 먼저 걸린다.
    // blank 판정은 사용자 규칙보다 우선하므로, 이 훅에서 직접 가로채야 한다.
    blankReplacement: (content, node) => {
      if (isDiagramNode(node)) return diagramToFence(node);
      if (isAttachmentNode(node)) return attachmentToLink(node);
      return node.isBlock ? "\n\n" : "";
    },
  });
  turndown.use(gfm);

  // 내용이 있는 다이어그램/첨부 div 도 같은 결과를 내야 한다.
  turndown.addRule("ksDiagram", {
    filter: isDiagramNode,
    replacement: (_content, node) => diagramToFence(node),
  });
  turndown.addRule("ksAttachment", {
    filter: isAttachmentNode,
    replacement: (_content, node) => attachmentToLink(node),
  });

  // 체크리스트 항목: 접두사·들여쓰기 규약은 turndown 기본 listItem 규칙을 따른다.
  turndown.addRule("ksTaskItem", {
    filter: isTaskItem,
    replacement: (content, node) => {
      const body = content
        .replace(/^\n+/, "")
        .replace(/\s+$/, "")
        .replace(/\n/gm, "\n    ");
      const checked = attr(node, "data-checked") === "true";
      const marker = ksComment("task", {
        due: attr(node, "data-due-date", "data-due"),
        assignee: attr(node, "data-assignee"),
        priority: attr(node, "data-priority") === "normal" ? "" : attr(node, "data-priority"),
      });
      return `${TASK_MARKER} [${checked ? "x" : " "}] ${body}${marker}\n`;
    },
  });

  // 체크박스 UI 잔재(label/input)는 마크다운에 자리가 없다.
  turndown.addRule("ksTaskChrome", {
    filter: (node) =>
      (node.nodeName === "LABEL" || node.nodeName === "INPUT") && hasTaskItemAncestor(node),
    replacement: () => "",
  });

  // TipTap 체크리스트 본문 래퍼 <div> 는 블록 여백을 만들지 않고 그대로 통과시킨다.
  turndown.addRule("ksTaskBody", {
    filter: (node) => node.nodeName === "DIV" && hasTaskItemAncestor(node),
    replacement: (content) => content.trim(),
  });

  // 밑줄은 Markdown 에 없다 — 인라인 HTML 로 보존한다(marked 가 그대로 되돌린다).
  turndown.addRule("ksUnderline", {
    filter: ["u"],
    replacement: (content) => (content ? `<u>${content}</u>` : ""),
  });

  // gfm 플러그인은 물결 1개(`~x~`)를 쓴다. GitHub 정본 표기인 2개로 통일한다.
  turndown.addRule("ksStrikethrough", {
    filter: ["del", "s", "strike"],
    replacement: (content) => (content ? `~~${content}~~` : ""),
  });

  // 이미지: 폭·정렬·캡션·자산경로를 ks 주석으로 보존한다.
  turndown.addRule("ksImage", {
    filter: "img",
    replacement: (_content, node) => {
      const alt = attr(node, "alt");
      const src = attr(node, "src");
      const title = attr(node, "title");
      const align = attr(node, "data-align");
      const marker = ksComment("img", {
        width: widthOf(node),
        align: align === "center" ? "" : align,
        caption: attr(node, "data-caption"),
        assetPath: attr(node, "data-asset-path"),
      });
      const titlePart = title ? ` "${title.replace(/"/g, '\\"')}"` : "";
      return src ? `![${alt}](${src}${titlePart})${marker}` : "";
    },
  });

  return turndown;
};

let sharedTurndown = null;
const getTurndown = () => (sharedTurndown ||= createTurndown());

/**
 * TipTap rich HTML → Markdown.
 * @param {string} html TipTap 이 만든 노트 본문 HTML
 * @returns {string} ks 주석으로 고유 속성이 보존된 GFM Markdown
 */
export function richToMarkdown(html) {
  const source = String(html ?? "").trim();
  if (!source) return "";
  return getTurndown()
    .turndown(source)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ───────────────────── Markdown → rich HTML ───────────────────── */

/**
 * 목록 항목의 체크박스 토큰을 제거한다.
 * tight 목록에서는 항목 바로 아래, loose 목록에서는 paragraph 안쪽에 들어 있어 재귀로 훑는다.
 */
const withoutCheckbox = (tokens) => {
  let removed = false;
  const walk = (list) =>
    list
      .map((token) => {
        if (removed) return token;
        if (token.type === "checkbox") {
          removed = true;
          return null;
        }
        if (Array.isArray(token.tokens)) return { ...token, tokens: walk(token.tokens) };
        return token;
      })
      .filter(Boolean);
  return walk(tokens);
};

const buildRichMarked = () => {
  const instance = new Marked({ gfm: true, breaks: false });
  instance.use({
    renderer: {
      // ```mermaid / ```plantuml 은 KsNote 전용 다이어그램 블록으로 되살린다.
      code(token) {
        const lang = (token.lang || "").trim().split(/\s+/)[0].toLowerCase();
        if (DIAGRAM_TYPES.includes(lang)) {
          return `<div data-type="${lang}" data-code="${escapeAttribute(token.text)}"></div>`;
        }
        const body = token.escaped ? token.text : escapeXml(token.text);
        const cls = lang ? ` class="language-${lang}"` : "";
        return `<pre><code${cls}>${body}\n</code></pre>\n`;
      },
      list(token) {
        const items = token.items.map((item) => this.listitem(item)).join("");
        if (token.items.some((item) => item.task)) {
          return `<ul data-type="taskList">\n${items}</ul>\n`;
        }
        if (token.ordered) {
          const start = Number(token.start);
          return `<ol${start && start !== 1 ? ` start="${start}"` : ""}>\n${items}</ol>\n`;
        }
        return `<ul>\n${items}</ul>\n`;
      },
      listitem(token) {
        const body = this.parser.parse(withoutCheckbox(token.tokens), !!token.loose);
        if (!token.task) return `<li>${body}</li>\n`;
        const { text, ks } = splitKs(body);
        const attrs = [`data-checked="${token.checked ? "true" : "false"}"`];
        if (ks?.due) attrs.push(`data-due-date="${escapeAttribute(ks.due)}"`);
        if (ks?.assignee) attrs.push(`data-assignee="${escapeAttribute(ks.assignee)}"`);
        attrs.push(`data-priority="${escapeAttribute(ks?.priority || "normal")}"`);
        const trimmed = text.trim();
        // TaskItem 의 content 스키마는 "paragraph+" 라 본문은 반드시 블록으로 감싼다.
        const wrapped = /^<(p|div|ul|ol|pre|blockquote)[\s>]/.test(trimmed)
          ? trimmed
          : `<p>${trimmed}</p>`;
        return `<li ${attrs.join(" ")}>${wrapped}</li>\n`;
      },
    },
  });
  return instance;
};

let sharedRichMarked = null;
const getRichMarked = () => (sharedRichMarked ||= buildRichMarked());

/** <img …><!--ks:{…}--> → 속성이 복원된 <img …> */
const restoreImageAttrs = (html) =>
  html.replace(/<img([^>]*?)\s*\/?>\s*<!--ks:(\{[\s\S]*?\})-->/g, (whole, imgAttrs, raw) => {
    const ks = parseKs(raw);
    if (!ks || ks.t !== "img") return whole;
    const extra = [];
    if (ks.width) extra.push(`style="width:${escapeAttribute(ks.width)}"`);
    if (ks.align) extra.push(`data-align="${escapeAttribute(ks.align)}"`);
    if (ks.caption) extra.push(`data-caption="${escapeAttribute(ks.caption)}"`);
    if (ks.assetPath) extra.push(`data-asset-path="${escapeAttribute(ks.assetPath)}"`);
    return `<img${imgAttrs}${extra.length ? ` ${extra.join(" ")}` : ""}>`;
  });

/** [이름](경로)<!--ks:{"t":"attach"}--> → 첨부 블록 div */
const restoreAttachments = (html) =>
  html
    .replace(
      // 링크 텍스트를 `[^<>]*` 로 묶어 서로 다른 두 링크에 걸쳐 매칭되는 것을 막는다.
      /<a href="([^"]*)"[^>]*>([^<>]*)<\/a>\s*<!--ks:(\{[\s\S]*?\})-->/g,
      (whole, href, name, raw) => {
        const ks = parseKs(raw);
        if (!ks || ks.t !== "attach") return whole;
        const label = decodeEntities(name);
        const attrs = [
          `data-type="attachment"`,
          `name="${escapeAttribute(label)}"`,
          `src="${escapeAttribute(href)}"`,
        ];
        if (ks.size) attrs.push(`size="${escapeAttribute(ks.size)}"`);
        if (ks.assetPath) attrs.push(`data-asset-path="${escapeAttribute(ks.assetPath)}"`);
        return `<div ${attrs.join(" ")}>${escapeXml(label)}</div>`;
      },
    )
    // 첨부만 담고 있는 문단 래퍼는 벗긴다(첨부는 블록 노드다).
    .replace(/<p>\s*(<div data-type="attachment"[\s\S]*?<\/div>)\s*<\/p>/g, "$1");

/**
 * Markdown → TipTap 이 그대로 먹을 수 있는 rich HTML.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToRich(markdown) {
  const source = String(markdown ?? "");
  if (!source.trim()) return "";
  let html = getRichMarked().parse(source);
  html = restoreAttachments(html);
  html = restoreImageAttrs(html);
  return html.replace(KS_COMMENT_RE_G, "").trim();
}

/* ──────────────── 플랫폼 내보내기 공용 토큰 워커 ──────────────── */

const sharedLexer = new Marked({ gfm: true, breaks: false });

/** 마크다운을 토큰 트리로 읽는다. */
const lex = (markdown) => sharedLexer.lexer(String(markdown ?? ""));

/**
 * 인라인 토큰을 타깃 렌더러로 옮긴다.
 * 밑줄은 `<u>`/`</u>` 인라인 HTML 로 오므로 열림/닫힘 태그를 각각 매핑한다.
 */
const renderInline = (tokens, target) =>
  (tokens || [])
    .map((token) => {
      switch (token.type) {
        case "text":
        case "escape":
          return token.tokens?.length
            ? renderInline(token.tokens, target)
            : target.text(decodeEntities(token.text));
        case "strong":
          return target.strong(renderInline(token.tokens, target));
        case "em":
          return target.em(renderInline(token.tokens, target));
        case "del":
          return target.del(renderInline(token.tokens, target));
        case "codespan":
          return target.codespan(decodeEntities(token.text));
        case "br":
          return target.br();
        case "link":
          return target.link(token.href, renderInline(token.tokens, target), token.title);
        case "image":
          return target.image(token.href, token.text, token.title);
        case "html": {
          const raw = token.text || "";
          if (KS_COMMENT_RE.test(raw)) return "";
          if (/^<u\s*>$/i.test(raw)) return target.underlineOpen();
          if (/^<\/u\s*>$/i.test(raw)) return target.underlineClose();
          return target.rawHtml(raw);
        }
        default:
          return target.text(decodeEntities(token.raw ?? token.text ?? ""));
      }
    })
    .join("");

/** 목록 항목 본문을 한 줄 인라인 문자열로 만든다(중첩 목록은 별도로 처리한다). */
const itemInline = (item, target) => {
  const own = (item.tokens || []).filter(
    (token) => token.type !== "list" && token.type !== "checkbox" && token.type !== "space",
  );
  return renderInline(
    own.flatMap((token) => (token.type === "paragraph" || token.type === "text" ? token.tokens || [token] : [token])),
    target,
  ).trim();
};

const nestedLists = (item) => (item.tokens || []).filter((token) => token.type === "list");

/** 블록 토큰 트리를 타깃 규격으로 옮긴다. */
const renderBlocks = (tokens, target, depth = 0) =>
  (tokens || [])
    .map((token) => {
      switch (token.type) {
        case "space":
        case "def":
          return "";
        case "heading":
          return target.heading(Math.min(6, token.depth), renderInline(token.tokens, target));
        case "paragraph":
          return target.paragraph(renderInline(token.tokens, target));
        case "text":
          return target.paragraph(
            token.tokens?.length ? renderInline(token.tokens, target) : target.text(token.text),
          );
        case "code":
          return target.code((token.lang || "").trim().split(/\s+/)[0], token.text);
        case "blockquote":
          return target.blockquote(renderBlocks(token.tokens, target, depth));
        case "hr":
          return target.hr();
        case "list":
          return target.list(token, depth);
        case "table":
          return target.table(toRenderedTable(readMarkdownTableToken(token), target.name));
        case "html": {
          const cleaned = stripKsComments(token.text).trim();
          return cleaned ? target.rawBlock(cleaned) : "";
        }
        default:
          return target.paragraph(target.text(String(token.text ?? token.raw ?? "").trim()));
      }
    })
    .filter((chunk) => chunk !== "" && chunk !== null && chunk !== undefined)
    .join(target.blockSeparator);

/* ─────────────────────────── Jira wiki ─────────────────────────── */

const jiraEscape = (value) => String(value ?? "").replace(/([{}\[\]])/g, "\\$1");
// 셀 내용은 이미 타깃 문법으로 렌더링된 상태다 — 여기서는 줄바꿈만 Jira 표기(\)로 바꾼다.
const jiraCell = (value) => String(value ?? "").replace(/[ \t]*\n/g, " \\\\ ");

const jiraTarget = {
  blockSeparator: "\n\n",
  name: "jira",
  text: jiraEscape,
  strong: (inner) => (inner ? `*${inner}*` : ""),
  em: (inner) => (inner ? `_${inner}_` : ""),
  del: (inner) => (inner ? `-${inner}-` : ""),
  underlineOpen: () => "+",
  underlineClose: () => "+",
  codespan: (code) => `{{${code}}}`,
  br: () => "\n",
  rawHtml: () => "",
  rawBlock: () => "",
  link: (href, inner) => (inner && inner !== href ? `[${inner}|${href}]` : `[${href}]`),
  image: (href, alt) => (alt ? `!${href}|alt=${alt}!` : `!${href}!`),
  heading: (depth, inner) => `h${depth}. ${inner}`,
  paragraph: (inner) => inner,
  code: (lang, body) => `{code${lang ? `:${lang}` : ""}}\n${body}\n{code}`,
  blockquote: (body) => `{quote}\n${body}\n{quote}`,
  hr: () => "----",
  list(token, depth) {
    const bullet = token.ordered ? "#" : "*";
    return token.items
      .map((item) => {
        const prefix = bullet.repeat(depth + 1);
        // Jira 는 (/) 를 초록 체크, (x) 를 빨간 X 로 렌더링한다.
        const box = item.task ? (item.checked ? "(/) " : "(x) ") : "";
        const { text } = splitKs(itemInline(item, this));
        const lines = [`${prefix} ${box}${text}`];
        for (const child of nestedLists(item)) lines.push(this.list(child, depth + 1));
        return lines.join("\n");
      })
      .join("\n");
  },
  table(table) {
    const head = `||${table.headers.map(jiraCell).join("||")}||`;
    const body = table.rows.map((row) => `|${row.map(jiraCell).join("|")}|`);
    const note = table.notes.length ? [`{color:#707070}※ ${table.notes.join(" / ")}{color}`] : [];
    return [head, ...body, ...note].join("\n");
  },
};

/**
 * Markdown → Jira wiki markup.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToJira(markdown) {
  return renderBlocks(lex(markdown), jiraTarget).replace(/\n{3,}/g, "\n\n").trim();
}

/* ─────────────────────── Confluence storage ─────────────────────── */

let confluenceTaskId = 0;

const confluenceTarget = {
  blockSeparator: "\n",
  name: "confluence",
  text: escapeXml,
  strong: (inner) => (inner ? `<strong>${inner}</strong>` : ""),
  em: (inner) => (inner ? `<em>${inner}</em>` : ""),
  del: (inner) => (inner ? `<span style="text-decoration: line-through;">${inner}</span>` : ""),
  underlineOpen: () => "<u>",
  underlineClose: () => "</u>",
  codespan: (code) => `<code>${escapeXml(code)}</code>`,
  br: () => "<br />",
  rawHtml: () => "",
  rawBlock: () => "",
  link: (href, inner) => `<a href="${escapeXml(href)}">${inner || escapeXml(href)}</a>`,
  image: (href, alt) =>
    `<ac:image${alt ? ` ac:alt="${escapeXml(alt)}"` : ""}><ri:url ri:value="${escapeXml(href)}" /></ac:image>`,
  heading: (depth, inner) => `<h${depth}>${inner}</h${depth}>`,
  paragraph: (inner) => `<p>${inner}</p>`,
  code: (lang, body) =>
    [
      `<ac:structured-macro ac:name="code">`,
      lang ? `<ac:parameter ac:name="language">${escapeXml(lang)}</ac:parameter>` : "",
      // CDATA 안에 ]]> 가 들어가면 섹션이 끊긴다 — 표준 분할 관용구로 잘라 붙인다.
      `<ac:plain-text-body><![CDATA[${String(body).replace(/]]>/g, "]]]]><![CDATA[>")}]]></ac:plain-text-body>`,
      `</ac:structured-macro>`,
    ]
      .filter(Boolean)
      .join(""),
  blockquote: (body) => `<blockquote>${body}</blockquote>`,
  hr: () => "<hr />",
  list(token, depth) {
    if (token.items.some((item) => item.task)) {
      const tasks = token.items
        .map((item) => {
          const { text } = splitKs(itemInline(item, this));
          const status = item.checked ? "complete" : "incomplete";
          return `<ac:task><ac:task-id>${++confluenceTaskId}</ac:task-id><ac:task-status>${status}</ac:task-status><ac:task-body>${text}</ac:task-body></ac:task>`;
        })
        .join("");
      return `<ac:task-list>${tasks}</ac:task-list>`;
    }
    const tag = token.ordered ? "ol" : "ul";
    const items = token.items
      .map((item) => {
        const { text } = splitKs(itemInline(item, this));
        const children = nestedLists(item)
          .map((child) => this.list(child, depth + 1))
          .join("");
        return `<li>${text}${children}</li>`;
      })
      .join("");
    return `<${tag}>${items}</${tag}>`;
  },
  table(table) {
    const cell = (value, tag) =>
      `<${tag}>${String(value ?? "").replace(/[ \t]*\n/g, "<br />")}</${tag}>`;
    const head = `<tr>${table.headers.map((value) => cell(value, "th")).join("")}</tr>`;
    const body = table.rows
      .map((row) => `<tr>${row.map((value) => cell(value, "td")).join("")}</tr>`)
      .join("");
    const note = table.notes.length
      ? `<p><em>※ ${escapeXml(table.notes.join(" / "))}</em></p>`
      : "";
    return `<table><tbody>${head}${body}</tbody></table>${note}`;
  },
};

/**
 * Markdown → Confluence storage format (XHTML).
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToConfluence(markdown) {
  confluenceTaskId = 0;
  return renderBlocks(lex(markdown), confluenceTarget).trim();
}

/* ───────────────────────── GitHub (GFM) ───────────────────────── */

/** 본문에 백틱 펜스가 들어 있으면 더 긴 펜스로 감싼다. */
const fenceFor = (body) => {
  const longest = Math.max(0, ...[...String(body).matchAll(/`{3,}/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
};

const githubTarget = {
  blockSeparator: "\n\n",
  name: "github",
  text: (value) => String(value ?? ""),
  strong: (inner) => (inner ? `**${inner}**` : ""),
  em: (inner) => (inner ? `*${inner}*` : ""),
  del: (inner) => (inner ? `~~${inner}~~` : ""),
  // GFM 에는 밑줄 문법이 없다 — GitHub 이 렌더링하는 인라인 HTML 을 그대로 남긴다.
  underlineOpen: () => "<u>",
  underlineClose: () => "</u>",
  codespan: (code) => {
    const ticks = "`".repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map((m) => m[0].length + 1)));
    return `${ticks}${code}${ticks}`;
  },
  br: () => "  \n",
  rawHtml: (raw) => raw,
  rawBlock: (raw) => raw,
  link: (href, inner, title) =>
    `[${inner}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`,
  image: (href, alt, title) =>
    `![${alt}](${href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ""})`,
  heading: (depth, inner) => `${"#".repeat(depth)} ${inner}`,
  paragraph: (inner) => inner,
  code: (lang, body) => {
    const fence = fenceFor(body);
    return `${fence}${lang || ""}\n${body}\n${fence}`;
  },
  blockquote: (body) =>
    body
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n"),
  hr: () => "---",
  list(token, depth) {
    const indent = "  ".repeat(depth);
    let counter = Number(token.start) || 1;
    return token.items
      .map((item) => {
        const marker = token.ordered ? `${counter++}.` : "-";
        const box = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
        const { text } = splitKs(itemInline(item, this));
        const lines = [`${indent}${marker} ${box}${text}`];
        for (const child of nestedLists(item)) lines.push(this.list(child, depth + 1));
        return lines.join("\n");
      })
      .join("\n");
  },
  table(table) {
    const cell = (value) => String(value ?? "").replace(/[ \t]*\n/g, "<br>");
    const divider = table.headers.map((_, index) => {
      const align = table.align?.[index];
      if (align === "center") return ":---:";
      if (align === "right") return "---:";
      if (align === "left") return ":---";
      return "---";
    });
    const lines = [
      `| ${table.headers.map(cell).join(" | ")} |`,
      `| ${divider.join(" | ")} |`,
      ...table.rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    ];
    if (table.notes.length) lines.push("", `> ※ ${table.notes.join(" / ")}`);
    return lines.join("\n");
  },
};

/**
 * Markdown → GitHub Flavored Markdown 정규화.
 * 체크박스는 `- [ ]`/`- [x]`, 코드는 펜스, 표는 파이프로 통일하고 ks 주석은 제거한다.
 * mermaid 펜스는 GitHub 이 그대로 렌더링하므로 유지한다.
 * @param {string} markdown
 * @returns {string}
 */
export function markdownToGithub(markdown) {
  return renderBlocks(lex(markdown), githubTarget).replace(/\n{3,}/g, "\n\n").trim();
}

/* ───────────────────────────── 표 변환 ───────────────────────────── */

/** 표 셀은 타깃별로 파이프만 추가로 escape 한다(링크 문법의 파이프는 건드리지 않는다). */
const CELL_TARGETS = {
  jira: { ...jiraTarget, text: (value) => jiraEscape(value).replace(/\|/g, "\\|") },
  confluence: confluenceTarget,
  github: { ...githubTarget, text: (value) => String(value ?? "").replace(/\|/g, "\\|") },
};

const TABLE_TARGETS = { jira: jiraTarget, confluence: confluenceTarget, github: githubTarget };

/** 셀 하나를 타깃 문법의 문자열로 만든다. 토큰이 있으면 서식을 살린다. */
const renderCell = (cell, targetName) => {
  const target = CELL_TARGETS[targetName];
  if (cell && Array.isArray(cell.tokens) && cell.tokens.length) {
    return renderInline(cell.tokens, target).trim();
  }
  return target.text(decodeEntities(cell?.text ?? cell ?? "")).trim();
};

/** 중립 표 모델의 모든 셀을 타깃 문법 문자열로 렌더링한다. */
const toRenderedTable = (model, targetName) => ({
  headers: model.headers.map((cell) => renderCell(cell, targetName)),
  rows: model.rows.map((row) => row.map((cell) => renderCell(cell, targetName))),
  align: model.align,
  notes: model.notes,
});

const inlineTokensOf = (markdown) => {
  const blocks = lex(markdown);
  return blocks.length === 1 && (blocks[0].type === "paragraph" || blocks[0].type === "text")
    ? blocks[0].tokens || []
    : [];
};

const makeCell = (markdownText) => ({
  text: String(markdownText ?? ""),
  tokens: inlineTokensOf(markdownText),
});

/** marked 의 table 토큰 → 중립 표 모델 */
const readMarkdownTableToken = (token) => ({
  headers: token.header.map((cell) => ({ text: cell.text, tokens: cell.tokens })),
  rows: token.rows.map((row) => row.map((cell) => ({ text: cell.text, tokens: cell.tokens }))),
  align: token.align || [],
  notes: [],
});

/** HTML 셀 내부를 마크다운 조각으로 옮긴다(줄바꿈은 보존). */
const htmlCellToMarkdown = (innerHtml) => {
  const markdown = getTurndown().turndown(`<div>${innerHtml}</div>`);
  return markdown.replace(/\n{2,}/g, "\n").trim();
};

const attrOfTag = (tagAttrs, name) => {
  const match = new RegExp(`${name}\s*=\s*"([^"]*)"`, "i").exec(tagAttrs || "");
  return match ? match[1] : "";
};

/**
 * DOM 없이 <table> 을 중립 표 모델로 읽는다.
 * colspan 은 같은 값의 셀 반복으로 펼치고, rowspan 은 첫 행에만 값을 남긴다(3항 참조).
 */
const parseHtmlTable = (html) => {
  const notes = [];
  const rowChunks = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1]);
  const carried = new Map(); // 열 인덱스 → 남은 rowspan 횟수
  const grid = [];
  let sawColspan = false;
  let sawRowspan = false;

  for (const chunk of rowChunks) {
    const row = [];
    let column = 0;
    const skipCarried = () => {
      while (carried.has(column)) {
        row[column] = makeCell("");
        const left = carried.get(column) - 1;
        if (left > 0) carried.set(column, left);
        else carried.delete(column);
        column += 1;
      }
    };
    const cells = [...chunk.matchAll(/<(th|td)([^>]*)>([\s\S]*?)<\/\1>/gi)];
    for (const [, tag, tagAttrs, inner] of cells) {
      skipCarried();
      const colspan = Math.max(1, Number(attrOfTag(tagAttrs, "colspan")) || 1);
      const rowspan = Math.max(1, Number(attrOfTag(tagAttrs, "rowspan")) || 1);
      if (colspan > 1) sawColspan = true;
      if (rowspan > 1) sawRowspan = true;
      const cell = makeCell(htmlCellToMarkdown(inner));
      for (let offset = 0; offset < colspan; offset += 1) {
        row[column] = { ...cell, tokens: cell.tokens, header: tag.toLowerCase() === "th" };
        if (rowspan > 1) carried.set(column, rowspan - 1);
        column += 1;
      }
    }
    skipCarried();
    if (row.length) grid.push([...row].map((cell) => cell || makeCell("")));
  }

  if (sawColspan) notes.push("병합 셀(colspan)을 같은 값의 칸으로 펼쳤습니다");
  if (sawRowspan) notes.push("세로 병합(rowspan)은 첫 행에만 값을 남기고 나머지는 빈 칸입니다");
  if (!grid.length) return { headers: [], rows: [], align: [], notes };

  const firstIsHeader = grid[0].every((cell) => cell.header);
  if (!firstIsHeader) notes.push("제목 행이 없어 첫 행을 제목 행으로 올렸습니다");
  return { headers: grid[0], rows: grid.slice(1), align: [], notes };
};

/**
 * 표 하나를 플랫폼별 문법으로 변환한다.
 * @param {string} input GFM 마크다운 표 또는 <table> HTML
 * @param {'jira'|'confluence'|'github'} target
 * @returns {string}
 */
export function convertTable(input, target) {
  const targetName = String(target || "").toLowerCase();
  const renderer = TABLE_TARGETS[targetName];
  if (!renderer) {
    throw new Error(`지원하지 않는 변환 대상입니다: ${target} (jira|confluence|github)`);
  }
  const source = String(input ?? "").trim();
  if (!source) return "";

  let model;
  if (/<table[\s>]/i.test(source)) {
    model = parseHtmlTable(source);
  } else {
    const tableToken = lex(source).find((token) => token.type === "table");
    if (!tableToken) throw new Error("입력에서 표를 찾지 못했습니다.");
    model = readMarkdownTableToken(tableToken);
  }
  return renderer.table(toRenderedTable(model, targetName));
}

/* ─────────────────────── Context Capsule ─────────────────────── */

const toIsoString = (now) => {
  if (now === undefined || now === null) return new Date().toISOString();
  const date = now instanceof Date ? now : new Date(now);
  return Number.isNaN(date.getTime()) ? String(now) : date.toISOString();
};

/** parentId 로 노트를 트리로 묶는다. 부모가 사라진 노트는 루트로 올린다(캡슐에서 유실 방지). */
const buildNoteTree = (notes) => {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const children = new Map();
  const roots = [];
  for (const note of notes) {
    const parentId = note.parentId && byId.has(note.parentId) ? note.parentId : null;
    if (parentId === null) roots.push(note);
    else children.set(parentId, [...(children.get(parentId) || []), note]);
  }
  return { roots, children };
};

/** 미완료 체크리스트 항목만 뽑는다. */
const openTasksOf = (markdown) => {
  const found = [];
  const walk = (tokens) => {
    for (const token of tokens || []) {
      if (token.type === "list") {
        for (const item of token.items) {
          if (item.task && !item.checked) {
            // 표시용 본문은 인라인 렌더링에서, 메타는 원문의 ks 주석에서 각각 얻는다.
            // renderInline 은 ks 주석을 이미 지운 상태로 넘겨주기 때문이다.
            const { text } = splitKs(itemInline(item, githubTarget));
            const { ks } = splitKs(item.text ?? item.raw ?? "");
            found.push({ text: text.trim(), due: ks?.due || "", assignee: ks?.assignee || "" });
          }
          walk((item.tokens || []).filter((child) => child.type === "list"));
        }
      } else if (token.type === "blockquote") {
        walk(token.tokens);
      }
    }
  };
  walk(lex(markdown));
  return found;
};

/**
 * 프로젝트 하나를 LLM·동료에게 통째로 건넬 수 있는 단일 Markdown 문서로 묶는다.
 * @param {{project:{id:string,name:string}, notes:Array<{id:string,title:string,parentId?:string|null,content?:string,trashed?:boolean}>, now?:Date|number|string}} input
 * @returns {string}
 */
export function buildContextCapsule({ project, notes, now } = {}) {
  const safeProject = project || { id: "", name: "(이름 없는 프로젝트)" };
  const live = (notes || []).filter((note) => note && !note.trashed);
  const { roots, children } = buildNoteTree(live);

  const ordered = [];
  const walkTree = (list, depth) => {
    for (const note of list) {
      ordered.push({ note, depth });
      walkTree(children.get(note.id) || [], depth + 1);
    }
  };
  walkTree(roots, 0);

  const bodies = new Map(
    ordered.map(({ note }) => [note.id, richToMarkdown(note.content || "")]),
  );

  const lines = [
    `# Context Capsule — ${safeProject.name || "(이름 없는 프로젝트)"}`,
    "",
    `- 프로젝트 ID: \`${safeProject.id || "-"}\``,
    `- 생성 시각: ${toIsoString(now)}`,
    `- 노트 수: ${ordered.length}${live.length !== (notes || []).length ? " (휴지통 제외)" : ""}`,
    "",
    "## 노트 트리",
    "",
  ];

  if (ordered.length === 0) {
    lines.push("_노트가 없습니다._", "");
  } else {
    for (const { note, depth } of ordered) {
      lines.push(`${"  ".repeat(depth)}- ${note.title || "(제목 없음)"}`);
    }
    lines.push("");
  }

  const openTasks = ordered.flatMap(({ note }) =>
    openTasksOf(bodies.get(note.id) || "").map((task) => ({ ...task, noteTitle: note.title })),
  );
  lines.push("## 열린 작업", "");
  if (openTasks.length === 0) {
    lines.push("_미완료 작업이 없습니다._", "");
  } else {
    for (const task of openTasks) {
      const meta = [
        task.due ? `마감 ${task.due}` : "",
        task.assignee ? `담당 ${task.assignee}` : "",
        `노트 ${task.noteTitle || "(제목 없음)"}`,
      ].filter(Boolean);
      lines.push(`- [ ] ${task.text} — ${meta.join(" · ")}`);
    }
    lines.push("");
  }

  lines.push("## 노트 본문", "");
  if (ordered.length === 0) {
    lines.push("_노트가 없습니다._");
  } else {
    ordered.forEach(({ note, depth }, index) => {
      lines.push(`### ${index + 1}. ${note.title || "(제목 없음)"}`);
      lines.push("");
      lines.push(
        `<!-- ks-note id=${note.id} depth=${depth} parent=${note.parentId || "root"} -->`,
      );
      lines.push("");
      const body = bodies.get(note.id) || "";
      lines.push(body || "_(빈 노트)_");
      lines.push("");
      if (index < ordered.length - 1) lines.push("---", "");
    });
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}
