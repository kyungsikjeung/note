import React, { useEffect, useId, useRef, useState } from "react";
import {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import mermaid from "mermaid";
import { marked } from "marked";
import DOMPurify from "dompurify";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Palette,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table2,
  Plus,
  Minus,
  Merge,
  Split,
  Trash2,
  ChevronDown,
  Heading1,
  Heading2,
  List,
  ListChecks,
  ListOrdered,
  Quote,
  Undo2,
  Redo2,
  Code2,
  Pilcrow,
  SeparatorHorizontal,
  Image as ImageIcon,
  Paperclip,
  Sparkles,
  Send,
  ChevronUp,
  X,
  Check,
  MessageSquare,
  FilePenLine,
  LoaderCircle,
  Workflow,
  Copy,
  Link2,
  Search,
  Replace,
  ListTree,
  Download,
  GripVertical,
  FoldVertical,
  ScanText,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  History,
  Square,
  RotateCcw,
  Eraser,
  Globe2,
  FilePlus2,
  Command,
} from "lucide-react";
import "./rich-editor.css";
import "./palette-fix.css";
import "./slash-rich.css";
import "./image-block.css";
import "./ai-dock.css";
import "./ai-sessions.css";
import "./code-block.css";
import "./mermaid-block.css";
import "./view-modes.css";
import "./preview-mermaid.css";
import "./task-list.css";
import "./editor-tools.css";
import "./code-tools.css";
import "./outline.css";
import "./toc-block.css";
import "./diagram-picker.css";
import "./image-gen-block.css";

const lowlight = createLowlight(common);

const stripHtmlFence = (value) =>
  String(value || "")
    .replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

const extractExternalLinks = (value) =>
  Array.from(
    new Set(
      String(value || "").match(
        /https?:\/\/[^\s<>"')\]]+|(?:[A-Z][A-Z0-9]+-\d+)/g,
      ) || [],
    ),
  ).slice(0, 20);

const parseAtlassianTargets = (values) =>
  values.map((value) => {
    if (!/^https?:/i.test(value)) {
      return {
        type: "jira",
        issueKey: value.toUpperCase(),
        source: value,
      };
    }
    try {
      const url = new URL(value);
      const issueKey =
        url.pathname.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1] ||
        url.searchParams.get("selectedIssue");
      if (issueKey)
        return {
          type: "jira",
          site: url.origin,
          projectKey: issueKey.split("-")[0].toUpperCase(),
          issueKey: issueKey.toUpperCase(),
          source: value,
        };
      const spaceKey =
        url.pathname.match(/\/spaces\/([^/]+)/i)?.[1] ||
        url.searchParams.get("spaceKey");
      const pageId =
        url.pathname.match(/\/pages\/(\d+)/i)?.[1] ||
        url.searchParams.get("pageId");
      return {
        type: "confluence",
        site: url.origin,
        spaceKey: spaceKey ? decodeURIComponent(spaceKey) : null,
        pageId,
        source: value,
      };
    } catch {
      return { type: "unknown", source: value };
    }
  });

const contentRevision = (value) => {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
};

const detectEncodingDamage = (value) => {
  const text = String(value || "");
  if (!text) return null;
  if (text.includes("\ufffd"))
    return "텍스트에 유니코드 대체 문자(�)가 포함되어 있습니다.";
  const questionRuns = text.match(/\?{2,}/g) || [];
  const questionCount = questionRuns.reduce((sum, item) => sum + item.length, 0);
  const visibleLength = text.replace(/\s/g, "").length || 1;
  const hasMarkdownStructure = /(^|\n)\s{0,3}(#{1,6}\s|\d+\.\s|-\s)/.test(text);
  if (
    text.length >= 30 &&
    questionRuns.length >= 3 &&
    questionCount / visibleLength > 0.12 &&
    hasMarkdownStructure
  )
    return "텍스트가 인코딩 손상으로 깨진 것처럼 보입니다.";
  return null;
};

const parseAIPatch = (value, fallbackTarget) => {
  const raw = String(value || "").trim();
  const candidate = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const patch = JSON.parse(candidate);
    if (
      patch?.version === 1 &&
      ["replace", "insert_before", "insert_after"].includes(patch.operation) &&
      typeof patch.html === "string"
    ) {
      return {
        ...patch,
        target: ["note", "selection", "block", "table"].includes(patch.target)
          ? patch.target
          : fallbackTarget,
      };
    }
  } catch {}
  return {
    version: 1,
    operation: "replace",
    target: fallbackTarget,
    html: raw,
    summary: "AI 편집 결과",
    legacy: true,
  };
};

const wantsWholeNoteEdit = (instruction) =>
  /(?:문서|노트|페이지)\s*전체|전체\s*(?:문서|노트|페이지)/i.test(
    String(instruction || ""),
  );

const requestedEditOperation = (instruction) => {
  const value = String(instruction || "");
  if (!/(?:추가|삽입|붙여\s*넣)/i.test(value)) return "replace";
  if (/(?:위|앞|이전)\s*(?:에|으로)?\s*(?:추가|삽입|붙여\s*넣)/i.test(value))
    return "insert_before";
  return "insert_after";
};

const serializeEditorRange = (editor, range, fallback = "") => {
  if (!range) return fallback;
  try {
    return editor.view.serializeForClipboard(
      editor.state.doc.slice(range.from, range.to),
    ).dom.innerHTML;
  } catch {
    return fallback;
  }
};

const getActiveBlockContext = (editor) => {
  const { selection } = editor.state;
  const { from, to, $from } = selection;
  if (from !== to)
    return {
      target: "selection",
      range: { from, to },
      nodeType: "selection",
      label: "선택 영역",
    };
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!node.isTextblock) continue;
    return {
      target: "block",
      range: { from: $from.before(depth), to: $from.after(depth) },
      nodeType: node.type.name,
      label:
        node.type.name === "codeBlock"
          ? "현재 코드 블록"
          : node.type.name === "heading"
            ? "현재 제목"
            : "현재 문단",
      cursorOffset: $from.parentOffset,
      ancestors: Array.from({ length: depth }, (_, index) =>
        $from.node(index + 1).type.name,
      ),
    };
  }
  return {
    target: "note",
    range: null,
    nodeType: "doc",
    label: "전체 노트",
  };
};

const preserveTableFormatting = (sourceHtml, replacementHtml) => {
  if (!sourceHtml || !replacementHtml) return replacementHtml;
  const source = new DOMParser().parseFromString(sourceHtml, "text/html");
  const replacement = new DOMParser().parseFromString(
    replacementHtml,
    "text/html",
  );
  const sourceCells = [...source.querySelectorAll("th,td")];
  const replacementCells = [...replacement.querySelectorAll("th,td")];
  replacementCells.forEach((cell, index) => {
    const original = sourceCells[index];
    if (!original) return;
    ["style", "class", "colspan", "rowspan"].forEach((attribute) => {
      if (original.hasAttribute(attribute) && !cell.hasAttribute(attribute))
        cell.setAttribute(attribute, original.getAttribute(attribute));
    });
    [...original.attributes]
      .filter((attribute) => attribute.name.startsWith("data-"))
      .forEach((attribute) => {
        if (!cell.hasAttribute(attribute.name))
          cell.setAttribute(attribute.name, attribute.value);
      });
  });
  return replacement.body.innerHTML;
};

const normalizeRichHtml = (
  value,
  { allowImages = true, preserveEmptyParagraphs = false } = {},
) => {
  const stripped = stripHtmlFence(value);
  const source = /<\/?[a-z][\s\S]*>/i.test(stripped)
    ? stripped
    : marked.parse(stripped);
  const sanitized = DOMPurify.sanitize(source, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
  const documentNode = new DOMParser().parseFromString(sanitized, "text/html");
  if (!allowImages)
    documentNode.querySelectorAll("img").forEach((image) => image.remove());
  documentNode.querySelectorAll("li").forEach((item) => {
    const meaningfulText = item.textContent.replace(/\u00a0/g, " ").trim();
    const meaningfulBlock = item.querySelector(
      "img,table,pre,ul,ol,[data-type]",
    );
    if (!meaningfulText && !meaningfulBlock) item.remove();
  });
  documentNode.querySelectorAll("ul,ol").forEach((list) => {
    if (!list.querySelector(":scope > li")) list.remove();
  });
  if (!preserveEmptyParagraphs)
    documentNode.querySelectorAll("p").forEach((paragraph) => {
      if (
        !paragraph.textContent.replace(/\u00a0/g, " ").trim() &&
        !paragraph.querySelector("img,br,[data-type]")
      )
        paragraph.remove();
    });
  return documentNode.body.innerHTML.trim();
};

const SmartCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return { ...this.parent?.(), collapsed: { default: false, parseHTML: (element) => element.getAttribute("data-collapsed") === "true", renderHTML: (attrs) => ({ "data-collapsed": String(Boolean(attrs.collapsed)) }) } };
  },
});

const downloadSvg = (svg, name, format = "svg") => {
  if (!svg) return;
  if (format === "svg") {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `${name}.svg` });
    link.click(); URL.revokeObjectURL(url); return;
  }
  const image = new window.Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || 1200; canvas.height = image.naturalHeight || 800;
    canvas.getContext("2d").drawImage(image, 0, 0);
    canvas.toBlob((blob) => { const pngUrl = URL.createObjectURL(blob); const link = Object.assign(document.createElement("a"), { href: pngUrl, download: `${name}.png` }); link.click(); URL.revokeObjectURL(pngUrl); URL.revokeObjectURL(url); }, "image/png");
  };
  image.src = url;
};

const downloadTextFile = (content, name, extension = "txt", type = "text/plain") => {
  const url = URL.createObjectURL(new Blob([content || ""], { type }));
  const link = Object.assign(document.createElement("a"), {
    href: url,
    download: `${name}.${extension}`,
  });
  link.click();
  URL.revokeObjectURL(url);
};

const mermaidToPlantUml = (source) => {
  const lines = source.split(/\r?\n/).filter((line) => !/^\s*(flowchart|graph|sequenceDiagram)/.test(line));
  const converted = lines.map((line) => line
    .replace(/([A-Za-z0-9_]+)\[([^\]]+)\]/g, "[$2]")
    .replace(/-->>?/g, "->")
    .replace(/\s*:\s*/, " : "));
  return `@startuml\n${converted.join("\n")}\n@enduml`;
};
const plantUmlToMermaid = (source) => {
  const lines = source.split(/\r?\n/).filter((line) => !/^\s*@(?:start|end)uml/.test(line));
  const isSequence = lines.some((line) => /\w+\s*-+>\s*\w+\s*:/.test(line));
  return `${isSequence ? "sequenceDiagram" : "flowchart LR"}\n${lines.map((line) => line.replace(/\[([^\]]+)\]/g, (_, label) => `${label.replace(/\W/g, "_")}[${label}]`).replace(/\s*:\s*/, ": ")).join("\n")}`;
};
const replaceDiagramNode = (editor, getPos, type, code) => {
  const pos = getPos();
  const current = editor.state.doc.nodeAt(pos);
  if (!current) return;
  const replacement = editor.schema.nodes[type].create({ code });
  editor.view.dispatch(editor.state.tr.replaceWith(pos, pos + current.nodeSize, replacement));
};

const StyledCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: null,
        parseHTML: (e) => e.style.backgroundColor || null,
        renderHTML: (a) =>
          a.backgroundColor
            ? { style: `background-color:${a.backgroundColor}` }
            : {},
      },
      textColor: {
        default: null,
        parseHTML: (e) => e.style.color || null,
        renderHTML: (a) =>
          a.textColor ? { style: `color:${a.textColor}` } : {},
      },
      textAlign: {
        default: "left",
        parseHTML: (e) => e.style.textAlign || "left",
        renderHTML: (a) => ({ style: `text-align:${a.textAlign || "left"}` }),
      },
    };
  },
});
const StyledHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      backgroundColor: {
        default: "#eef3f3",
        parseHTML: (e) => e.style.backgroundColor || "#eef3f3",
        renderHTML: (a) => ({
          style: `background-color:${a.backgroundColor || "#eef3f3"}`,
        }),
      },
      textColor: {
        default: null,
        parseHTML: (e) => e.style.color || null,
        renderHTML: (a) =>
          a.textColor ? { style: `color:${a.textColor}` } : {},
      },
      textAlign: {
        default: "left",
        parseHTML: (e) => e.style.textAlign || "left",
        renderHTML: (a) => ({ style: `text-align:${a.textAlign || "left"}` }),
      },
    };
  },
});
const SmartTaskItem = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      dueDate: { default: "", parseHTML: (e) => e.getAttribute("data-due-date") || "", renderHTML: (a) => a.dueDate ? { "data-due-date": a.dueDate } : {} },
      assignee: { default: "", parseHTML: (e) => e.getAttribute("data-assignee") || "", renderHTML: (a) => a.assignee ? { "data-assignee": a.assignee } : {} },
      priority: { default: "normal", parseHTML: (e) => e.getAttribute("data-priority") || "normal", renderHTML: (a) => ({ "data-priority": a.priority }) },
    };
  },
});

function ResizableImageView({ node, selected, updateAttributes }) {
  const [ocrLoading, setOcrLoading] = useState(false);
  const runOcr = async () => {
    setOcrLoading(true);
    try {
      const { recognize } = await import("tesseract.js");
      const result = await recognize(node.attrs.src, "kor+eng");
      updateAttributes({ caption: result.data.text.trim() });
    } catch (error) {
      window.alert(`OCR 실패: ${error.message}`);
    } finally {
      setOcrLoading(false);
    }
  };
  const startResize = (event, direction) => {
    event.preventDefault();
    event.stopPropagation();
    const image = event.currentTarget.parentElement.querySelector("img");
    const startX = event.clientX,
      startWidth = image.getBoundingClientRect().width;
    const move = (e) => {
      const delta = (e.clientX - startX) * direction;
      updateAttributes({
        width: `${Math.max(120, Math.min(1400, startWidth + delta))}px`,
      });
    };
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  };
  return (
    <NodeViewWrapper
      className={`resizable-image ${selected ? "selected" : ""}`}
      style={{ textAlign: node.attrs.align || "center" }}
    >
      <span
        className="image-frame"
        style={{ width: node.attrs.width || "auto" }}
      >
        {selected && (
          <div className="image-context">
            <span>이미지</span>
            {["25%", "50%", "75%", "100%"].map((size) => (
              <button
                key={size}
                className={node.attrs.width === size ? "active" : ""}
                onClick={() => updateAttributes({ width: size })}
              >
                {size}
              </button>
            ))}
            <i />
            <button onClick={() => updateAttributes({ align: "left" })}>
              <AlignLeft />
            </button>
            <button onClick={() => updateAttributes({ align: "center" })}>
              <AlignCenter />
            </button>
            <button onClick={() => updateAttributes({ align: "right" })}>
              <AlignRight />
            </button>
            <button disabled={ocrLoading} title="이미지 글자 추출" onClick={runOcr}>
              <ScanText /> {ocrLoading ? "인식 중" : "OCR"}
            </button>
          </div>
        )}
        <span
          className="image-handle left"
          onPointerDown={(e) => startResize(e, -1)}
        />
        <img
          src={node.attrs.src}
          alt={node.attrs.alt || ""}
          title={node.attrs.title || ""}
          draggable="false"
        />
        <span
          className="image-handle right"
          onPointerDown={(e) => startResize(e, 1)}
        />
        <small className="image-size">{node.attrs.width || "원본 크기"}</small>
        {selected ? (
          <input
            className="image-caption-input"
            value={node.attrs.caption || ""}
            placeholder="이미지 설명 입력"
            onChange={(event) => updateAttributes({ caption: event.target.value })}
          />
        ) : node.attrs.caption ? (
          <span className="image-caption">{node.attrs.caption}</span>
        ) : null}
      </span>
    </NodeViewWrapper>
  );
}

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "auto",
        parseHTML: (e) => e.style.width || e.getAttribute("width") || "auto",
        renderHTML: (a) => ({ style: `width:${a.width}` }),
      },
      align: {
        default: "center",
        parseHTML: (e) => e.getAttribute("data-align") || "center",
        renderHTML: (a) => ({ "data-align": a.align }),
      },
      caption: {
        default: "",
        parseHTML: (e) => e.getAttribute("data-caption") || "",
        renderHTML: (a) => (a.caption ? { "data-caption": a.caption } : {}),
      },
      assetPath: {
        default: "",
        parseHTML: (e) => e.getAttribute("data-asset-path") || "",
        renderHTML: (a) => a.assetPath ? { "data-asset-path": a.assetPath } : {},
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

function ImageGenerationView({ node, selected, updateAttributes, deleteNode, editor, getPos }) {
  const [draft, setDraft] = useState(node.attrs.prompt || "");
  const activeRequestRef = useRef(null);
  const isWorking = ["queued", "running"].includes(node.attrs.status);
  const replaceWithGeneratedImage = (prompt, src) => {
    if (!src || editor.isDestroyed) return;
    const pos = getPos();
    if (typeof pos !== "number") return;
    const imageNode = editor.schema.nodes.image.create({
      src,
      alt: prompt,
      title: prompt,
      caption: prompt,
      width: "75%",
      align: "center",
    });
    editor.view.dispatch(
      editor.state.tr.replaceWith(pos, pos + node.nodeSize, imageNode),
    );
  };
  const startGeneration = async (prompt = draft, { force = false } = {}) => {
    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt || (node.attrs.status === "running" && !force)) return;
    const requestId = `imggen-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    activeRequestRef.current = requestId;
    updateAttributes({
      prompt: cleanPrompt,
      status: "running",
      error: "",
      resultSrc: "",
      updatedAt: Date.now(),
    });
    try {
      if (!window.ksnoteImage?.generate)
        throw new Error("Codex 이미지 생성 브릿지가 연결되지 않았습니다.");
      const result = await window.ksnoteImage.generate({
        prompt: cleanPrompt,
        requestId,
        command: "codex",
      });
      if (activeRequestRef.current !== requestId) return;
      replaceWithGeneratedImage(cleanPrompt, result?.src);
    } catch (error) {
      if (activeRequestRef.current !== requestId) return;
      updateAttributes({
        status: "error",
        error: error.message || "이미지를 생성할 수 없습니다.",
        updatedAt: Date.now(),
      });
    }
  };
  useEffect(() => {
    let frame = 0;
    if (node.attrs.status === "queued" && node.attrs.prompt) {
      frame = window.requestAnimationFrame(() =>
        startGeneration(node.attrs.prompt, { force: true }),
      );
    }
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      activeRequestRef.current = null;
    };
  }, []);
  return (
    <NodeViewWrapper className={`image-gen-block ${selected ? "selected" : ""} status-${node.attrs.status}`} contentEditable={false}>
      <header>
        <span><Sparkles /> 이미지 생성</span>
        <small>{node.attrs.status === "error" ? "확인 필요" : isWorking ? "생성 중" : "대기"}</small>
        <button title="삭제" onClick={deleteNode}><Trash2 /></button>
      </header>
      <div className="image-gen-body">
        <label className="image-gen-prompt">
          <span>프롬프트</span>
          <textarea
            value={draft}
            placeholder="예: 궤도 위에 떠 있는 지식 노트 앱 콘셉트 이미지"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") startGeneration();
            }}
          />
        </label>
        <div className="image-gen-preview">
          <div className="image-gen-canvas" aria-label="생성 중인 이미지 미리보기">
            <i className="image-gen-orbit one" />
            <i className="image-gen-orbit two" />
            <i className="image-gen-core" />
            <span><LoaderCircle /> {isWorking ? "이미지로 변환 중" : "프롬프트 대기"}</span>
          </div>
        </div>
      </div>
      {node.attrs.error && <p className="image-gen-error">{node.attrs.error}</p>}
      {!isWorking && (
      <footer>
        <button disabled={!draft.trim() || isWorking} onClick={() => startGeneration()}>
          <Sparkles /> 생성 시작
        </button>
      </footer>
      )}
    </NodeViewWrapper>
  );
}

const ImageGenerationBlock = Node.create({
  name: "imageGenerationBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      prompt: { default: "", parseHTML: (e) => e.getAttribute("data-prompt") || "", renderHTML: (a) => a.prompt ? { "data-prompt": a.prompt } : {} },
      status: { default: "idle", parseHTML: (e) => e.getAttribute("data-status") || "idle", renderHTML: (a) => ({ "data-status": a.status || "idle" }) },
      resultSrc: { default: "", parseHTML: (e) => e.getAttribute("data-result-src") || "", renderHTML: (a) => a.resultSrc ? { "data-result-src": a.resultSrc } : {} },
      error: { default: "", parseHTML: (e) => e.getAttribute("data-error") || "", renderHTML: (a) => a.error ? { "data-error": a.error } : {} },
      updatedAt: { default: 0, parseHTML: (e) => Number(e.getAttribute("data-updated-at") || 0), renderHTML: (a) => a.updatedAt ? { "data-updated-at": a.updatedAt } : {} },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="image-generation"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-type": "image-generation" }]; },
  addNodeView() { return ReactNodeViewRenderer(ImageGenerationView); },
});

function AttachmentView({ node, deleteNode }) {
  return (
    <NodeViewWrapper className="attachment-block">
      <Paperclip />
      <span>
        <b>{node.attrs.name || "첨부파일"}</b>
        <small>{node.attrs.size ? `${Math.ceil(node.attrs.size / 1024)} KB` : "로컬 첨부파일"}</small>
      </span>
      <a href={node.attrs.src} download={node.attrs.name}>열기 / 저장</a>
      <button title="첨부 삭제" onClick={deleteNode}><Trash2 /></button>
    </NodeViewWrapper>
  );
}

const AttachmentBlock = Node.create({
  name: "attachmentBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: "첨부파일" },
      size: { default: 0 },
      src: { default: "" },
      assetPath: { default: "" },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="attachment"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-type": "attachment" }, HTMLAttributes.name || "첨부파일"]; },
  addNodeView() { return ReactNodeViewRenderer(AttachmentView); },
});

function PlantUmlView({ node, selected, updateAttributes, deleteNode, editor, getPos }) {
  const [mode, setMode] = useState("split");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const prefs = JSON.parse(localStorage.getItem("mori-prefs") || "{}");
        const output = await window.ksnoteDiagram?.renderPlantUml({ code: node.attrs.code, jarPath: prefs.plantumlJar });
        if (live) { setSvg(output || ""); setError(""); }
      } catch (err) { if (live) setError(err.message || "PlantUML을 렌더링할 수 없습니다."); }
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [node.attrs.code]);
  return (
    <NodeViewWrapper className={`mermaid-block plantuml-block ${selected ? "selected" : ""}`}>
      <header>
        <span><Workflow /> PlantUML</span>
        <nav>{["source", "split", "preview"].map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
        <button title="소스 복사" onClick={() => navigator.clipboard.writeText(node.attrs.code)}><Copy /></button>
        <button title="SVG 저장" onClick={() => downloadSvg(svg, "plantuml-diagram")}><Download /></button>
        <button title="PNG 저장" onClick={() => downloadSvg(svg, "plantuml-diagram", "png")}>PNG</button>
        <button title="Mermaid 블록으로 변환" onClick={() => replaceDiagramNode(editor, getPos, "mermaidBlock", plantUmlToMermaid(node.attrs.code))}>→ Mermaid</button>
        <button title="삭제" onClick={deleteNode}><Trash2 /></button>
      </header>
      <div className={`mermaid-body mode-${mode}`}>
        {mode !== "preview" && <textarea value={node.attrs.code} onChange={(event) => updateAttributes({ code: event.target.value })} spellCheck="false" />}
        {mode !== "source" && <div className="mermaid-preview">{error ? <p>{error}</p> : <div dangerouslySetInnerHTML={{ __html: svg }} />}</div>}
      </div>
    </NodeViewWrapper>
  );
}

const PlantUmlBlock = Node.create({
  name: "plantUmlBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() { return { code: { default: "@startuml\nAlice -> Bob: Hello\n@enduml", parseHTML: (element) => element.getAttribute("data-code") || "", renderHTML: (attrs) => ({ "data-code": attrs.code }) } }; },
  parseHTML() { return [{ tag: 'div[data-type="plantuml"]' }]; },
  renderHTML({ HTMLAttributes }) { return ["div", { ...HTMLAttributes, "data-type": "plantuml" }]; },
  addNodeView() { return ReactNodeViewRenderer(PlantUmlView); },
});

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
});
function MermaidView({ node, selected, updateAttributes, deleteNode, editor, getPos }) {
  const [mode, setMode] = useState("split"),
    [error, setError] = useState(""),
    [svgOutput, setSvgOutput] = useState("");
  const renderSeq = useRef(0);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    const currentSeq = renderSeq.current + 1;
    renderSeq.current = currentSeq;
    let live = true;
    setError("");
    setSvgOutput("");
    mermaid
      .render(`ks-mermaid-${id}-${currentSeq}`, node.attrs.code)
      .then(({ svg }) => {
        if (live && renderSeq.current === currentSeq) {
          setSvgOutput(svg);
          setError("");
        }
      })
      .catch((err) => {
        if (live && renderSeq.current === currentSeq) {
          setSvgOutput("");
          setError(err.message?.split("\n")[0] || "Mermaid 문법을 확인하세요");
        }
      });
    return () => {
      live = false;
    };
  }, [node.attrs.code, id]);
  return (
    <NodeViewWrapper className={`mermaid-block ${selected ? "selected" : ""}`}>
      <header>
        <span>
          <Workflow /> Mermaid
        </span>
        <nav>
          <button
            className={mode === "source" ? "active" : ""}
            onClick={() => setMode("source")}
          >
            Source
          </button>
          <button
            className={mode === "split" ? "active" : ""}
            onClick={() => setMode("split")}
          >
            Split
          </button>
          <button
            className={mode === "preview" ? "active" : ""}
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
        </nav>
        <button
          title="소스 복사"
          onClick={() => navigator.clipboard.writeText(node.attrs.code)}
        >
          <Copy />
        </button>
        <button title="SVG 저장" onClick={() => downloadSvg(svgOutput, "mermaid-diagram")}><Download /></button>
        <button title="PNG 저장" onClick={() => downloadSvg(svgOutput, "mermaid-diagram", "png")}>PNG</button>
        <button title="PlantUML 블록으로 변환" onClick={() => replaceDiagramNode(editor, getPos, "plantUmlBlock", mermaidToPlantUml(node.attrs.code))}>→ PlantUML</button>
        <button title="삭제" onClick={deleteNode}>
          <Trash2 />
        </button>
      </header>
      <div className={`mermaid-body mode-${mode}`}>
        {mode !== "preview" && (
          <textarea
            value={node.attrs.code}
            onChange={(e) => updateAttributes({ code: e.target.value })}
            spellCheck="false"
          />
        )}
        {mode !== "source" && (
          <div className="mermaid-preview">
            {error ? <p>{error}</p> : <div dangerouslySetInnerHTML={{ __html: svgOutput }} />}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}
const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      code: {
        default: "flowchart LR\n  A[시작] --> B[완료]",
        parseHTML: (e) => e.getAttribute("data-code") || "",
        renderHTML: (a) => ({ "data-code": a.code }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "mermaid" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});

const defaultDrawIoXml = `<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="900" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`;

const DRAWIO_ORIGIN = "https://embed.diagrams.net";
const DRAWIO_ALLOWED_ORIGINS = new Set([
  "https://embed.diagrams.net",
  "https://app.diagrams.net",
]);
const DRAWIO_EDITOR_URL =
  `${DRAWIO_ORIGIN}/?embed=1&proto=json&spin=1&libraries=1&saveAndExit=1&noExitBtn=1&suppressNewWindows=1&ui=atlas`;

function DrawIoView({ node, selected, updateAttributes, deleteNode }) {
  const iframeRef = useRef(null);
  const [mode, setMode] = useState(node.attrs.view || "edit");
  const [status, setStatus] = useState("loading");
  const code = node.attrs.code || defaultDrawIoXml;
  const postDrawIo = (message) => {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify(message), "*");
  };
  useEffect(() => {
    if (mode !== "edit") return undefined;
    const handleMessage = (event) => {
      if (!DRAWIO_ALLOWED_ORIGINS.has(event.origin) || !event.data) return;
      let payload = event.data;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }
      if (!payload || typeof payload !== "object") return;
      if (payload.event === "init") {
        setStatus("ready");
        postDrawIo({
          action: "load",
          xml: code,
          autosave: 1,
          saveAndExit: 1,
          noExitBtn: 1,
          title: "KsNote draw.io",
          modified: 0,
        });
      } else if ((payload.event === "autosave" || payload.event === "save") && payload.xml) {
        updateAttributes({ code: payload.xml });
        setStatus(payload.event === "save" ? "saved" : "autosaved");
        if (payload.exit) setMode("source");
      } else if (payload.event === "load") {
        setStatus("ready");
      } else if (payload.event === "exit") {
        setMode("source");
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mode, code, updateAttributes]);
  return (
    <NodeViewWrapper className={`mermaid-block drawio-block ${selected ? "selected" : ""}`}>
      <header>
        <span><Workflow /> draw.io</span>
        <nav>
          {[
            ["edit", "Editor"],
            ["source", "XML"],
          ].map(([item, label]) => (
            <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
              {label}
            </button>
          ))}
        </nav>
        <button title="저장 요청" onClick={() => postDrawIo({ action: "save" })}><Check /></button>
        <button title="XML 복사" onClick={() => navigator.clipboard.writeText(code)}><Copy /></button>
        <button title="draw.io 파일 저장" onClick={() => downloadTextFile(code, "drawio-diagram", "drawio", "application/xml")}><Download /></button>
        <button title="삭제" onClick={deleteNode}><Trash2 /></button>
      </header>
      <div className={`drawio-body mode-${mode}`}>
        {mode === "source" ? (
          <textarea
            value={code}
            onChange={(event) => updateAttributes({ code: event.target.value })}
            spellCheck="false"
          />
        ) : (
          <div className="drawio-frame-shell">
            <iframe
              ref={iframeRef}
              title="draw.io editor"
              src={DRAWIO_EDITOR_URL}
              allow="clipboard-read; clipboard-write"
            />
            <span className={`drawio-status ${status}`}>{status === "loading" ? "Loading" : status === "saved" ? "Saved" : status === "autosaved" ? "Autosaved" : "Ready"}</span>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

const DrawIoBlock = Node.create({
  name: "drawIoBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      code: {
        default: defaultDrawIoXml,
        parseHTML: (e) => e.getAttribute("data-code") || "",
        renderHTML: (a) => ({ "data-code": a.code }),
      },
      view: {
        default: "edit",
        parseHTML: (e) => e.getAttribute("data-view") || "edit",
        renderHTML: (a) => ({ "data-view": a.view || "edit" }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="drawio"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "drawio" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DrawIoView);
  },
});

function TableOfContentsView({ editor, selected }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const update = () => {
      const headings = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.attrs.level <= 3) {
          headings.push({
            level: node.attrs.level,
            text: node.textContent.trim() || "제목 없음",
            pos: pos + 1,
          });
        }
      });
      setItems(headings);
    };
    update();
    editor.on("update", update);
    return () => editor.off("update", update);
  }, [editor]);
  const jumpToHeading = (pos) => {
    editor.chain().focus().setTextSelection(pos).scrollIntoView().run();
  };
  return (
    <NodeViewWrapper
      className={`toc-block ${selected ? "selected" : ""}`}
      contentEditable={false}
      data-type="table-of-contents"
    >
      <header>
        <ListTree />
        <b>목차</b>
        <small>{items.length}개 섹션</small>
      </header>
      {items.length ? (
        <nav aria-label="문서 목차">
          {items.map((item, index) => (
            <button
              type="button"
              key={`${item.pos}-${index}`}
              className={`toc-level-${item.level}`}
              onClick={() => jumpToHeading(item.pos)}
            >
              <i />
              <span>{item.text}</span>
            </button>
          ))}
        </nav>
      ) : (
        <p><code>#</code>, <code>##</code>, <code>###</code> 제목을 추가하면 목차가 자동으로 표시됩니다.</p>
      )}
    </NodeViewWrapper>
  );
}

const TableOfContentsBlock = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-type="table-of-contents"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", { ...HTMLAttributes, "data-type": "table-of-contents" }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsView);
  },
});

const asHtml = (value) =>
  normalizeRichHtml(value, { preserveEmptyParagraphs: true });

function RichPreview({ html }) {
  const root = useRef(null);
  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let live = true;
    host.innerHTML = html;
    const diagrams = Array.from(host.querySelectorAll('[data-type="mermaid"]'));
    diagrams.forEach((element, index) => {
      const code = element.getAttribute("data-code") || "";
      element.classList.add("preview-mermaid");
      element.setAttribute("aria-label", "Mermaid 다이어그램");
      mermaid
        .render(
          `ks-preview-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`,
          code,
        )
        .then(({ svg }) => {
          if (live && element.isConnected) element.innerHTML = svg;
        })
        .catch(() => {
          if (live && element.isConnected)
            element.innerHTML =
              '<p class="preview-mermaid-error">Mermaid 문법을 확인해 주세요.</p>';
        });
    });
    const plantDiagrams = Array.from(host.querySelectorAll('[data-type="plantuml"]'));
    plantDiagrams.forEach(async (element) => {
      try {
        const prefs = JSON.parse(localStorage.getItem("mori-prefs") || "{}");
        const svg = await window.ksnoteDiagram?.renderPlantUml({ code: element.getAttribute("data-code") || "", jarPath: prefs.plantumlJar });
        if (live && element.isConnected) { element.classList.add("preview-mermaid"); element.innerHTML = svg; }
      } catch (error) {
        if (live && element.isConnected) element.innerHTML = `<p class="preview-mermaid-error">${String(error.message || "PlantUML 렌더링 실패").replace(/[<>]/g, "")}</p>`;
      }
    });
    return () => {
      live = false;
    };
  }, [html]);
  return <article ref={root} className="split-preview" />;
}

const readImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      let dataUrl = reader.result;
      if (file.size > 1_500_000 && file.type !== "image/gif") {
        try {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(bitmap.width * scale);
          canvas.height = Math.round(bitmap.height * scale);
          canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL("image/webp", 0.86);
          bitmap.close();
        } catch {}
      }
      let assetPath = "";
      try {
        const asset = await window.ksnoteStorage?.saveAsset({ name: file.name, dataUrl });
        assetPath = asset?.path || "";
      } catch {
        // The editor remains usable in a browser where the Electron storage bridge is unavailable.
      }
      resolve({
        type: "image",
        attrs: {
          src: dataUrl,
          alt: file.name || "이미지",
          title: file.name || null,
          assetPath,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readAttachment = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      let assetPath = "";
      try {
        const asset = await window.ksnoteStorage?.saveAsset({ name: file.name, dataUrl: reader.result });
        assetPath = asset?.path || "";
      } catch {}
      resolve({ type: "attachmentBlock", attrs: { name: file.name, size: file.size, src: reader.result, assetPath } });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readFileBlock = (file) => file.type.startsWith("image/") ? readImage(file) : readAttachment(file);

function GridPicker({ onPick, onClose }) {
  const [size, setSize] = useState({ r: 3, c: 3 });
  return (
    <div className="inline-grid-popover" onMouseLeave={onClose}>
      <b>
        {size.r} × {size.c} 표
      </b>
      <div>
        {Array.from({ length: 8 }, (_, r) =>
          Array.from({ length: 8 }, (_, c) => (
            <button
              key={`${r}-${c}`}
              aria-label={`${r + 1}행 ${c + 1}열`}
              className={r < size.r && c < size.c ? "active" : ""}
              onMouseEnter={() => setSize({ r: r + 1, c: c + 1 })}
              onClick={() => onPick(r + 1, c + 1)}
            />
          )),
        )}
      </div>
      <small>드래그하거나 클릭해 표 크기 선택</small>
    </div>
  );
}

export default function RichDocumentEditor({
  noteId,
  projectId,
  content,
  mode = "edit",
  preferredModel = "gpt-5.6-sol",
  availableModels = [
    { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "codex" },
  ],
  agentCommands = { codex: "codex", claude: "claude" },
  preferences = { fontSize: 14, fontFamily: "sans", spellcheck: false },
  onChange,
  onCreateChildPage,
  onTargetChange,
  onExternalOperation,
}) {
  const [gridOpen, setGridOpen] = useState(false);
  const [diagramOpen, setDiagramOpen] = useState(false);
  const pendingDiagramPos = useRef(null);
  const [previewHtml, setPreviewHtml] = useState(() => asHtml(content));
  const fileInput = useRef(null);
  const pendingFilePos = useRef(null);
  const [slash, setSlash] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [findOpen, setFindOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [tableContextOpen, setTableContextOpen] = useState(false);
  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(window.localStorage.getItem("ksnote:editor-split-ratio"));
    return Number.isFinite(saved) && saved >= 25 && saved <= 75 ? saved : 50;
  });
  const [splitResizing, setSplitResizing] = useState(false);
  const splitGroupRef = useRef(null);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [recentCommands, setRecentCommands] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("ksnote-recent-commands")) || [];
    } catch {
      return [];
    }
  });
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const slashRef = useRef(null);
  const rootRef = useRef(null);
  const savedSelection = useRef(null);
  const composingRef = useRef(false);
  const externalOperationIds = useRef(new Set());
  const [aiOpen, setAiOpen] = useState(false),
    [aiMode, setAiMode] = useState("edit"),
    [aiPrompt, setAiPrompt] = useState(""),
    [aiModel, setAiModel] = useState(preferredModel),
    [aiLoading, setAiLoading] = useState(false),
    [aiResult, setAiResult] = useState(null),
    [aiError, setAiError] = useState(""),
    [aiStream, setAiStream] = useState(""),
    [aiProgress, setAiProgress] = useState({ stage: "idle", startedAt: 0 }),
    [aiElapsed, setAiElapsed] = useState(0),
    [aiSessionScope, setAiSessionScope] = useState("note"),
    [aiHistoryOpen, setAiHistoryOpen] = useState(false),
    [aiSessionMeta, setAiSessionMeta] = useState([]),
    [aiUsageBySession, setAiUsageBySession] = useState({}),
    [activeAiSessionId, setActiveAiSessionId] = useState(
      () => `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    ),
    [aiSessions, setAiSessions] = useState(() => {
      try { return JSON.parse(localStorage.getItem("ksnote-ai-prompt-sessions")) || []; }
      catch { return []; }
    });
  const aiTargetRef = useRef(null);
  const aiRequestRef = useRef(null);
  const writeAiDebugLog = (requestId, patch) => {
    if (!preferences.developerMode) return;
    try {
      const key = "ksnote-ai-debug-logs";
      const logs = JSON.parse(localStorage.getItem(key)) || [];
      const index = logs.findIndex((item) => item.requestId === requestId);
      const next = index >= 0
        ? logs.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch, updatedAt: Date.now() } : item)
        : [{ requestId, createdAt: Date.now(), updatedAt: Date.now(), ...patch }, ...logs];
      localStorage.setItem(key, JSON.stringify(next.slice(0, 50)));
      window.dispatchEvent(new CustomEvent("ksnote-ai-debug-log", { detail: next.slice(0, 50) }));
    } catch {}
  };
  const writeAiAuditLog = (entry) => {
    try {
      const key = "ksnote-ai-audit-log";
      const logs = JSON.parse(localStorage.getItem(key)) || [];
      localStorage.setItem(
        key,
        JSON.stringify([{ at: Date.now(), noteId, projectId, ...entry }, ...logs].slice(0, 200)),
      );
    } catch {}
  };
  const writeEditorDebugLog = (entry) => {
    if (!preferences.developerMode) return;
    try {
      const key = "ksnote-editor-debug-logs";
      const logs = JSON.parse(localStorage.getItem(key)) || [];
      const next = [{ id: `editor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, createdAt: Date.now(), ...entry }, ...logs].slice(0, 30);
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent("ksnote-editor-debug-log", { detail: next }));
    } catch {}
  };
  useEffect(() => setAiModel(preferredModel), [preferredModel]);
  useEffect(() => {
    localStorage.setItem("ksnote-ai-prompt-sessions", JSON.stringify(aiSessions.slice(0, 100)));
  }, [aiSessions]);
  useEffect(() => {
    let live = true;
    window.ksnoteAI?.turns?.({ projectId }).then((rows) => {
      if (!live || !Array.isArray(rows)) return;
      const restored = rows.map((row) => ({
        id: row.id,
        sessionId: row.session_id,
        noteId: row.note_id,
        projectId: row.project_id,
        instruction: row.instruction,
        mode: row.mode,
        provider: row.provider,
        model: row.model,
        target: "note",
        sourceRevision: row.source_revision,
        appliedRevision: row.applied_revision,
        output: row.status === "error" ? "" : row.response,
        error: row.status === "error" ? row.response : "",
        status: row.applied_revision ? "applied" : row.status,
        createdAt: row.created_at,
        respondedAt: row.updated_at,
        restored: true,
      }));
      setAiSessions((current) => {
        const localById = new Map(current.map((session) => [session.id, session]));
        restored.forEach((session) => {
          localById.set(session.id, {
            ...session,
            ...(localById.get(session.id) || {}),
          });
        });
        return Array.from(localById.values())
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
          .slice(0, 100);
      });
    }).catch(() => {});
    return () => { live = false; };
  }, [projectId]);
  useEffect(() => {
    let live = true;
    window.ksnoteAI?.sessions?.({ projectId }).then((rows) => {
      if (!live || !Array.isArray(rows)) return;
      setAiSessionMeta(rows);
      setAiUsageBySession((current) => {
        const next = { ...current };
        rows.forEach((row) => {
          next[row.id] = {
            last: {
              inputTokens: row.context_tokens || 0,
              outputTokens: 0,
              totalTokens: row.context_tokens || 0,
            },
            total: {
              inputTokens: row.input_tokens || 0,
              outputTokens: row.output_tokens || 0,
              totalTokens: row.total_tokens || 0,
            },
            modelContextWindow: row.context_window || 0,
          };
        });
        return next;
      });
    }).catch(() => {});
    return () => { live = false; };
  }, [projectId, aiHistoryOpen]);
  useEffect(() => window.ksnoteAI?.onUsage?.(({ sessionId, usage }) => {
    setAiUsageBySession((current) => ({ ...current, [sessionId]: usage }));
  }), []);
  useEffect(() => window.ksnoteAI?.onCompacted?.(({ sessionId }) => {
    setAiUsageBySession((current) => ({
      ...current,
      [sessionId]: {
        total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        modelContextWindow: 0,
      },
    }));
  }), []);
  useEffect(() => {
    setActiveAiSessionId(
      `ai-session-${noteId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    );
    setAiResult(null);
    setAiError("");
    setAiStream("");
  }, [noteId]);
  useEffect(() => window.ksnoteAI?.onChunk?.(({ requestId, chunk }) => {
    if (requestId === aiRequestRef.current) {
      setAiProgress((value) => ({ ...value, stage: "receiving" }));
      setAiStream((value) => value + chunk);
    }
  }), []);
  useEffect(() => {
    if (!aiLoading || !aiProgress.startedAt) {
      setAiElapsed(0);
      return undefined;
    }
    const update = () =>
      setAiElapsed(Math.max(0, Date.now() - aiProgress.startedAt));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [aiLoading, aiProgress.startedAt]);
  const visibleAiSessions = aiSessions.filter((session) => aiSessionScope === "project" ? session.projectId === projectId : session.noteId === noteId);
  const visibleAiConversations = Array.from(
    visibleAiSessions.reduce((groups, session) => {
      const sessionId = session.sessionId || session.id;
      if (!groups.has(sessionId)) {
        const meta = aiSessionMeta.find((item) => item.id === sessionId);
        groups.set(sessionId, {
          ...session,
          sessionId,
          title: meta?.title || session.instruction,
          usage: aiUsageBySession[sessionId],
          turnCount: visibleAiSessions.filter(
            (item) => (item.sessionId || item.id) === sessionId,
          ).length,
          compactedAt: meta?.compacted_at || null,
        });
      }
      return groups;
    }, new Map()).values(),
  );
  const detectedPromptLinks = extractExternalLinks(aiPrompt);
  const slashCommands = [
    {
      id: "page",
      label: "하위 페이지",
      command: "/page",
      description: "현재 페이지 아래에 새 페이지 생성",
      icon: FilePlus2,
      keywords: "page 페이지 하위페이지 child subpage notion",
    },
    {
      id: "table",
      label: "표",
      command: "/table",
      description: "행과 열로 구성된 표 삽입",
      icon: Table2,
      keywords: "table 표 테이블",
    },
    {
      id: "file",
      label: "파일 업로드",
      command: "/file",
      description: "이미지 또는 GIF 파일 선택",
      icon: Paperclip,
      keywords: "file upload 파일 업로드 image gif",
    },
    {
      id: "imggen",
      label: "이미지 생성",
      command: "/imggen",
      description: "프롬프트를 블록으로 처리하고 계속 편집",
      icon: Sparkles,
      keywords: "imggen image generate 생성 이미지 그림 ai",
    },
    {
      id: "code",
      label: "코드 블록",
      command: "/code",
      description: "고정폭 글꼴의 코드 영역",
      icon: Code2,
      keywords: "code 코드 snippet",
    },
    {
      id: "diagram",
      label: "다이어그램",
      command: "/diagram",
      description: "Mermaid, PlantUML, draw.io 형식 선택",
      icon: Workflow,
      keywords: "diagram 다이어그램 mermaid plantuml drawio uml",
    },
    {
      id: "mermaid",
      label: "Mermaid",
      command: "/mermaid",
      description: "편집 가능한 다이어그램 블록",
      icon: Workflow,
      keywords: "mermaid diagram flowchart 다이어그램",
    },
    {
      id: "plantuml",
      label: "PlantUML",
      command: "/plantuml",
      description: "PlantUML 로컬 런타임 설정 안내",
      icon: Code2,
      keywords: "plantuml uml diagram 다이어그램",
    },
    {
      id: "draw_edit",
      label: "draw.io 편집",
      command: "/draw_edit",
      description: "diagrams.net 편집창을 블록 안에서 열기",
      icon: Workflow,
      keywords: "draw drawio diagrams.net edit 다이어그램 편집",
    },
    {
      id: "draw_xml",
      label: "draw.io XML",
      command: "/draw_xml",
      description: "draw.io XML 소스 블록",
      icon: Code2,
      keywords: "draw drawio diagrams.net xml 다이어그램",
    },
    {
      id: "draw_mermaid",
      label: "draw Mermaid",
      command: "/draw_mermaid",
      description: "Mermaid 다이어그램 블록",
      icon: Workflow,
      keywords: "draw mermaid diagram flowchart 다이어그램",
    },
    {
      id: "toc",
      label: "목차",
      command: "/목차",
      description: "제목 1–3을 들여쓰기해 자동 표시",
      icon: ListTree,
      keywords: "toc table contents 목차 개요 notion confluence",
    },
    {
      id: "h1",
      label: "제목 1",
      command: "/h1",
      description: "큰 섹션 제목",
      icon: Heading1,
      keywords: "h1 heading 제목",
    },
    {
      id: "h2",
      label: "제목 2",
      command: "/h2",
      description: "중간 섹션 제목",
      icon: Heading2,
      keywords: "h2 heading 소제목",
    },
    ...[3, 4, 5, 6].map((level) => ({
      id: `h${level}`,
      label: `제목 ${level}`,
      command: `/h${level}`,
      description: `${level}단계 섹션 제목`,
      icon: Heading2,
      keywords: `h${level} heading 제목`,
    })),
    {
      id: "check",
      label: "할 일 목록",
      command: "/check",
      description: "완료 여부를 바로 체크하는 목록",
      icon: ListChecks,
      keywords: "check checklist task todo 체크 할일 작업",
    },
    {
      id: "bullet",
      label: "글머리 목록",
      command: "/list",
      description: "순서 없는 항목 목록",
      icon: List,
      keywords: "list bullet 목록",
    },
    {
      id: "number",
      label: "번호 목록",
      command: "/number",
      description: "순서가 있는 항목 목록",
      icon: ListOrdered,
      keywords: "number ordered 번호",
    },
    {
      id: "quote",
      label: "인용문",
      command: "/quote",
      description: "문장이나 발언 강조",
      icon: Quote,
      keywords: "quote 인용",
    },
    {
      id: "divider",
      label: "구분선",
      command: "/divider",
      description: "문서 영역 구분",
      icon: SeparatorHorizontal,
      keywords: "divider line 구분선",
    },
    {
      id: "text",
      label: "일반 텍스트",
      command: "/text",
      description: "기본 문단으로 입력",
      icon: Pilcrow,
      keywords: "text paragraph 텍스트",
    },
    ...(preferences.customSlashCommands || []).filter((item) => item.command && item.label).map((item) => ({
      id: `custom-${item.id}`,
      label: item.label,
      command: `/${item.command}`,
      description: "사용자 문서 템플릿",
      icon: Command,
      keywords: `${item.command} ${item.label} custom template`,
      template: item.template || "",
    })),
  ];
  const filtered = slash
    ? slashCommands
        .filter(
          (c) =>
            !slash.query ||
            `${c.label} ${c.command} ${c.keywords}`
              .toLowerCase()
              .includes(slash.query.toLowerCase()),
        )
        .sort((a, b) => {
          const ai = recentCommands.indexOf(a.id),
            bi = recentCommands.indexOf(b.id);
          return ai < 0 && bi < 0 ? 0 : ai < 0 ? 1 : bi < 0 ? -1 : ai - bi;
        })
        .slice(0, 7)
    : [];
  useEffect(() => {
    slashRef.current = { slash, filtered, index: slashIndex };
  }, [slash, filtered, slashIndex]);
  const detectSlash = (ed) => {
    const { $from } = ed.state.selection;
    if (!$from.parent.isTextblock) {
      setSlash(null);
      return;
    }
    const text = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      "\ufffc",
    );
    const match = text.match(/^\/(\S*)$/);
    if (!match) {
      setSlash(null);
      return;
    }
    const coords = ed.view.coordsAtPos($from.pos);
    const rect = rootRef.current?.getBoundingClientRect();
    setSlash({
      query: match[1],
      from: $from.start(),
      to: $from.pos,
      left: Math.max(12, coords.left - (rect?.left || 0)),
      top: coords.bottom - (rect?.top || 0) + 7,
    });
    setSlashIndex(0);
  };
  const runSlash = (item) => {
    const current = slashRef.current?.slash;
    if (!current || !item) return;
    const nextRecent = [
      item.id,
      ...recentCommands.filter((id) => id !== item.id),
    ].slice(0, 6);
    setRecentCommands(nextRecent);
    localStorage.setItem("ksnote-recent-commands", JSON.stringify(nextRecent));
    if (item.id === "file") {
      pendingFilePos.current = current.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from: current.from, to: current.to })
        .run();
      setSlash(null);
      requestAnimationFrame(() => fileInput.current?.click());
      return;
    }
    if (item.id === "diagram") {
      pendingDiagramPos.current = current.from;
      editor
        .chain()
        .focus()
        .deleteRange({ from: current.from, to: current.to })
        .run();
      setSlash(null);
      setDiagramOpen(true);
      return;
    }
    if (item.id === "page") {
      editor
        .chain()
        .focus()
        .deleteRange({ from: current.from, to: current.to })
        .run();
      setSlash(null);
      requestAnimationFrame(() => onCreateChildPage?.());
      return;
    }
    let chain = editor
      .chain()
      .focus()
      .deleteRange({ from: current.from, to: current.to });
    if (item.id === "table")
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    else if (item.id === "code") chain.setCodeBlock();
    else if (item.id === "mermaid")
      chain.insertContent({ type: "mermaidBlock" });
    else if (item.id === "plantuml")
      chain.insertContent({ type: "plantUmlBlock" });
    else if (item.id === "draw_edit")
      chain.insertContent({ type: "drawIoBlock", attrs: { view: "edit" } });
    else if (item.id === "draw_xml")
      chain.insertContent({ type: "drawIoBlock", attrs: { view: "source" } });
    else if (item.id === "draw_mermaid")
      chain.insertContent({ type: "mermaidBlock" });
    else if (item.id === "imggen")
      chain.insertContent([
        { type: "imageGenerationBlock" },
        { type: "paragraph" },
      ]);
    else if (item.id === "toc")
      chain.insertContent({ type: "tableOfContents" });
    else if (item.id === "check") chain.toggleTaskList();
    else if (item.id === "h1") chain.setHeading({ level: 1 });
    else if (/^h[1-6]$/.test(item.id))
      chain.setHeading({ level: Number(item.id.slice(1)) });
    else if (item.id === "bullet") chain.toggleBulletList();
    else if (item.id === "number") chain.toggleOrderedList();
    else if (item.id === "quote") chain.toggleBlockquote();
    else if (item.id === "divider") chain.setHorizontalRule();
    else if (item.id.startsWith("custom-")) chain.insertContent(marked.parse(item.template));
    else chain.setParagraph();
    chain.run();
    setSlash(null);
  };
  const commitEditorUpdate = (activeEditor) => {
    const html = activeEditor.getHTML();
    setPreviewHtml(html);
    onChange(html);
    detectSlash(activeEditor);
  };
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      SmartCodeBlock.configure({ lowlight, defaultLanguage: "plaintext" }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage.configure({ allowBase64: true, inline: false }),
      ImageGenerationBlock,
      AttachmentBlock,
      MermaidBlock,
      PlantUmlBlock,
      DrawIoBlock,
      TableOfContentsBlock,
      TaskList,
      SmartTaskItem.configure({ nested: true }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: "https",
      }),
      Table.configure({ resizable: true, allowTableNodeSelection: true }),
      TableRow,
      StyledHeader,
      StyledCell,
    ],
    content: asHtml(content),
    editorProps: {
      attributes: { class: "mori-rich-content" },
      handleDOMEvents: {
        compositionstart() {
          composingRef.current = true;
          return false;
        },
        compositionend() {
          composingRef.current = false;
          requestAnimationFrame(() => {
            if (editor && !editor.isDestroyed) commitEditorUpdate(editor);
          });
          return false;
        },
      },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files || []);
        const text = event.clipboardData?.getData("text/plain")?.trim() || "";
        const html = event.clipboardData?.getData("text/html") || "";
        if (!files.length && /^@startuml[\s\S]*@enduml\s*$/i.test(text)) {
          if (!window.confirm("PlantUML 다이어그램 블록으로 변환할까요?\n취소하면 일반 텍스트로 붙여 넣습니다.")) return false;
          event.preventDefault();
          editor?.chain().focus().insertContent({ type: "plantUmlBlock", attrs: { code: text } }).run();
          return true;
        }
        if (
          !files.length &&
          /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie)\b/m.test(
            text,
          )
        ) {
          if (!window.confirm("Mermaid 다이어그램 블록으로 변환할까요?\n취소하면 일반 텍스트로 붙여 넣습니다.")) return false;
          event.preventDefault();
          editor
            ?.chain()
            .focus()
            .insertContent({ type: "mermaidBlock", attrs: { code: text } })
            .run();
          return true;
        }
        if (!files.length && (text.startsWith("{") || text.startsWith("["))) {
          try {
            const formatted = JSON.stringify(JSON.parse(text), null, 2);
            if (!window.confirm("JSON 코드 블록으로 정리해서 붙여 넣을까요?\n취소하면 원문을 붙여 넣습니다.")) return false;
            event.preventDefault();
            editor
              ?.chain()
              .focus()
              .insertContent({
                type: "codeBlock",
                attrs: { language: "json" },
                content: [{ type: "text", text: formatted }],
              })
              .run();
            return true;
          } catch {}
        }
        const lines = text.split(/\r?\n/).filter((line) => line.length);
        const delimiter =
          lines.length > 1 && lines.every((line) => line.includes("\t"))
            ? "\t"
            : lines.length > 1 && lines.every((line) => line.includes(","))
              ? ","
              : null;
        if (!files.length && delimiter) {
          if (!window.confirm("편집 가능한 표로 변환할까요?\n취소하면 원문을 붙여 넣습니다.")) return false;
          event.preventDefault();
          const rows = lines.map((line) =>
            line.split(delimiter).map((cell) => cell.trim()),
          );
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: "table",
              content: rows.map((row, rowIndex) => ({
                type: "tableRow",
                content: row.map((value) => ({
                  type: rowIndex === 0 ? "tableHeader" : "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: value ? [{ type: "text", text: value }] : [],
                    },
                  ],
                })),
              })),
            })
            .run();
          return true;
        }
        if (
          !files.length &&
          !html &&
          /^#{1,6}\s|^[-*+]\s|^>\s|```|\[[ xX]\]/m.test(text)
        ) {
          if (!window.confirm("Markdown 서식을 적용해서 붙여 넣을까요?\n취소하면 원문을 붙여 넣습니다.")) return false;
          event.preventDefault();
          editor?.chain().focus().insertContent(marked.parse(text)).run();
          return true;
        }
        if (
          !files.length &&
          !html &&
          /\b(function|class|const|let|public|private|def|import|SELECT|CREATE|interface|namespace)\b|[{};]\s*$/m.test(
            text,
          )
        ) {
          if (!window.confirm("코드 블록으로 변환할까요?\n취소하면 원문을 붙여 넣습니다.")) return false;
          event.preventDefault();
          editor
            ?.chain()
            .focus()
            .insertContent({
              type: "codeBlock",
              content: [{ type: "text", text }],
            })
            .run();
          return true;
        }
        if (!files.length) return false;
        event.preventDefault();
        const insertPos = view.state.selection.from;
        Promise.all(files.map(readFileBlock)).then((blocks) => {
          editor?.commands.insertContentAt(insertPos, blocks);
          editor?.commands.focus();
        });
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []);
        if (!files.length) return false;
        event.preventDefault();
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        Promise.all(files.map(readFileBlock)).then((blocks) =>
          editor?.commands.insertContentAt(pos, blocks),
        );
        return true;
      },
      handleKeyDown(view, event) {
        if (
          event.key === "Enter" &&
          preferences.developerMode &&
          view.state.selection.$from.parent.type.name === "heading"
        ) {
          const { $from } = view.state.selection;
          const diagnostic = {
            event: "heading-enter",
            shiftKey: event.shiftKey,
            altKey: event.altKey,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            isComposing: event.isComposing,
            editorComposing: view.composing,
            keyCode: event.keyCode,
            nodeTypeBefore: $from.parent.type.name,
            headingLevelBefore: $from.parent.attrs.level ?? null,
            parentOffsetBefore: $from.parentOffset,
            contentSizeBefore: $from.parent.content.size,
            atEndBefore: $from.parentOffset === $from.parent.content.size,
            textBefore: $from.parent.textContent.slice(0, 300),
          };
          requestAnimationFrame(() => {
            if (view.isDestroyed) return;
            const { $from: $after } = view.state.selection;
            writeEditorDebugLog({
              ...diagnostic,
              nodeTypeAfter: $after.parent.type.name,
              headingLevelAfter: $after.parent.attrs.level ?? null,
              parentOffsetAfter: $after.parentOffset,
              contentSizeAfter: $after.parent.content.size,
              textAfter: $after.parent.textContent.slice(0, 300),
            });
          });
        }
        const menu = slashRef.current;
        if (menu?.slash && menu.filtered.length) {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setSlashIndex((i) => Math.min(i + 1, menu.filtered.length - 1));
            return true;
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setSlashIndex((i) => Math.max(i - 1, 0));
            return true;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            runSlash(menu.filtered[menu.index]);
            return true;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setSlash(null);
            return true;
          }
        }
        if (
          event.key === "ArrowRight" &&
          !event.ctrlKey &&
          !event.altKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          const { $from, empty } = view.state.selection;
          if (
            empty &&
            $from.parent.type.name === "codeBlock" &&
            $from.parentOffset === $from.parent.content.size
          ) {
            event.preventDefault();
            editor?.chain().focus().exitCode().run();
            return true;
          }
        }
        if (event.ctrlKey && event.altKey && event.key === "ArrowRight") {
          if (editor?.isActive("table")) {
            event.preventDefault();
            editor.chain().focus().addColumnAfter().run();
            return true;
          }
        }
        if (event.ctrlKey && event.altKey && event.key === "ArrowDown") {
          if (editor?.isActive("table")) {
            event.preventDefault();
            editor.chain().focus().addRowAfter().run();
            return true;
          }
        }
        if (event.key === "Enter") {
          const { $from } = view.state.selection;
          const rawText = $from.parent.textContent.trim();
          const imggenMatch = rawText.match(/^\/imggen\s+(.+)/i);
          if (imggenMatch) {
            event.preventDefault();
            editor
              ?.chain()
              .focus()
              .deleteRange({ from: $from.start(), to: $from.end() })
              .insertContent([
                {
                  type: "imageGenerationBlock",
                  attrs: { prompt: imggenMatch[1].trim(), status: "queued" },
                },
                { type: "paragraph" },
              ])
              .run();
            return true;
          }
          const text = rawText.toLowerCase();
          if (text === "/table" || text === "/표") {
            event.preventDefault();
            const from = $from.start(),
              to = $from.end();
            editor
              ?.chain()
              .focus()
              .deleteRange({ from, to })
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run();
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      if (composingRef.current || editor.view.composing) return;
      commitEditorUpdate(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) savedSelection.current = { from, to };
      setTableContextOpen(editor.isActive("table"));
      onTargetChange?.({
        noteId,
        projectId,
        from,
        to,
        empty: from === to,
        text: editor.state.doc.textBetween(from, to, "\n").slice(0, 240),
      });
      detectSlash(editor);
    },
  });
  useEffect(() => {
    if (editor) {
      const { from, to } = editor.state.selection;
      onTargetChange?.({
        noteId,
        projectId,
        from,
        to,
        empty: from === to,
        text: editor.state.doc.textBetween(from, to, "\n").slice(0, 240),
      });
      const incoming = asHtml(content);
      setPreviewHtml(incoming);
      if (editor.getHTML() !== incoming)
        editor.commands.setContent(incoming, false);
      if (
        /<li\b[^>]*>\s*(?:<p\b[^>]*>)?\s*(?:&nbsp;|\u00a0)?\s*(?:<\/p>)?\s*<\/li>/i.test(
          content || "",
        ) &&
        incoming !== content
      )
        onChange(incoming);
    }
  }, [noteId]);
  useEffect(() => {
    if (editor) editor.setEditable(mode !== "preview");
  }, [editor, mode]);
  useEffect(() => {
    if (!editor || !noteId || mode === "preview") return undefined;
    let stopped = false;
    const applyOperation = async (operation) => {
      if (!operation?.id || externalOperationIds.current.has(operation.id))
        return;
      const claimed = await window.ksnoteMcp?.claim?.({
        id: operation.id,
        noteId,
      });
      if (!claimed || claimed.status !== "applying") return;
      externalOperationIds.current.add(operation.id);
      try {
        const currentRevision = contentRevision(editor.getHTML());
        if (
          claimed.expectedRevision &&
          claimed.expectedRevision !== currentRevision
        ) {
        await window.ksnoteMcp?.complete?.({
            id: claimed.id,
            status: "error",
            code: "revision_conflict",
            message: "노트가 MCP 요청 이후 변경되었습니다.",
            currentRevision,
            expectedRevision: claimed.expectedRevision,
          });
          onExternalOperation?.({
            status: "error",
            message: "MCP 작업 실패: 노트가 변경되어 다이어그램을 삽입하지 않았습니다.",
          });
          return;
        }
        const isTextInsert = claimed.type === "text_insert";
        if (isTextInsert) {
          const encodingIssue = detectEncodingDamage(claimed.text);
          if (encodingIssue) {
            await window.ksnoteMcp?.complete?.({
              id: claimed.id,
              status: "error",
              code: "encoding_suspect",
              message: `${encodingIssue} 삽입을 중단했습니다.`,
            });
            onExternalOperation?.({
              status: "error",
              message: "MCP 작업 실패: 텍스트 인코딩이 깨진 것 같아 삽입하지 않았습니다.",
            });
            return;
          }
        }
        const format = String(claimed.format || "mermaid").toLowerCase();
        const nodeType = isTextInsert
          ? null
          : format === "plantuml"
            ? "plantUmlBlock"
            : format === "drawio"
              ? "drawIoBlock"
              : "mermaidBlock";
        const maxPos = editor.state.doc.content.size;
        const target = claimed.target || {};
        const from = claimed.operation === "append"
          ? maxPos
          : Number.isFinite(target.from)
          ? Math.max(0, Math.min(target.from, maxPos))
          : maxPos;
        const to = Number.isFinite(target.to)
          ? Math.max(from, Math.min(target.to, maxPos))
          : from;
        const range =
          claimed.operation === "replace-selection" || from !== to
            ? { from, to }
            : from;
        editor
          .chain()
          .focus()
          .insertContentAt(
            range,
            isTextInsert
              ? claimed.text || ""
              : {
                  type: nodeType,
                  attrs: {
                    code: claimed.code || "",
                    ...(format === "drawio" ? { view: "edit" } : {}),
                  },
                },
          )
          .run();
        const appliedRevision = contentRevision(editor.getHTML());
        await window.ksnoteMcp?.complete?.({
          id: claimed.id,
          status: "completed",
          appliedRevision,
        });
        onExternalOperation?.({
          status: "completed",
          message:
            isTextInsert
              ? "MCP 작업 완료: 텍스트를 삽입했습니다."
              : format === "plantuml"
              ? "MCP 작업 완료: PlantUML 다이어그램을 삽입했습니다."
              : format === "drawio"
                ? "MCP 작업 완료: draw.io 다이어그램을 삽입했습니다."
              : "MCP 작업 완료: Mermaid 다이어그램을 삽입했습니다.",
        });
      } catch (error) {
        await window.ksnoteMcp?.complete?.({
          id: operation.id,
          status: "error",
          code: "apply_failed",
          message: error.message || "MCP 작업 적용에 실패했습니다.",
        });
        onExternalOperation?.({
          status: "error",
          message: `MCP 작업 실패: ${error.message || "다이어그램을 삽입하지 못했습니다."}`,
        });
      }
    };
    const poll = async () => {
      if (stopped || !window.ksnoteMcp?.pending) return;
      const operations = await window.ksnoteMcp.pending({ noteId }).catch(
        () => [],
      );
      for (const operation of operations) await applyOperation(operation);
    };
    poll();
    const timer = window.setInterval(poll, 1000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [editor, noteId, mode]);
  useEffect(() => {
    if (!editor || !noteId) return undefined;
    const writeHeartbeat = () => {
      const { from, to } = editor.state.selection;
      window.ksnoteMcp?.heartbeat?.({
        noteId,
        projectId,
        mode,
        editable: mode !== "preview",
        revision: contentRevision(editor.getHTML()),
        selection: { from, to, empty: from === to },
      }).catch(() => {});
    };
    writeHeartbeat();
    const timer = window.setInterval(writeHeartbeat, 5000);
    return () => window.clearInterval(timer);
  }, [editor, noteId, projectId, mode]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute(
      "spellcheck",
      preferences.spellcheck ? "true" : "false",
    );
  }, [editor, preferences.spellcheck]);
  useEffect(() => {
    if (!editor) return;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const insideTable = Boolean(target.closest(".mori-rich-content td, .mori-rich-content th"));
      const insideTableToolbar = Boolean(target.closest(".table-context"));
      // A table pointerdown happens before ProseMirror updates its selection.
      // Let onSelectionUpdate activate the toolbar after the clicked cell is
      // the real editor selection; setting true here can render against the
      // previous paragraph selection and leave the toolbar stuck closed.
      if (insideTable) return;
      if (insideTableToolbar) return;
      setTableContextOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [editor]);
  useEffect(() => {
    if (!editor) return;
    const updateLineNumbers = () => editor.view.dom.querySelectorAll("pre").forEach((pre) => {
      if (composingRef.current || editor.view.composing) return;
      const count = Math.max(1, (pre.querySelector("code")?.textContent || "").split("\n").length);
      pre.setAttribute("data-line-numbers", Array.from({ length: count }, (_, index) => index + 1).join("\n"));
    });
    const updateAfterComposition = () => requestAnimationFrame(updateLineNumbers);
    updateLineNumbers();
    editor.on("update", updateLineNumbers);
    editor.view.dom.addEventListener("compositionend", updateAfterComposition);
    return () => {
      editor.off("update", updateLineNumbers);
      editor.view.dom.removeEventListener("compositionend", updateAfterComposition);
    };
  }, [editor]);
  if (!editor) return null;
  const inCode = editor.isActive("codeBlock");
  const inTask = editor.isActive("taskItem");
  const taskAttrs = editor.getAttributes("taskItem");
  const colors = ["#172426", "#147d72", "#2563eb", "#b42318", "#7c3aed"];
  const backgrounds = [
    "#ffffff",
    "#fff4c2",
    "#dcefeb",
    "#dbeafe",
    "#fce7e3",
    "#ede9fe",
    "#eef3f3",
  ];
  const insertTable = (r, c) => {
    editor
      .chain()
      .focus()
      .insertTable({ rows: r, cols: c, withHeaderRow: true })
      .run();
    setGridOpen(false);
  };
  const insertMermaid = () => {
    const pos = pendingDiagramPos.current;
    if (pos != null)
      editor.commands.insertContentAt(pos, { type: "mermaidBlock" });
    else editor.chain().focus().insertContent({ type: "mermaidBlock" }).run();
    pendingDiagramPos.current = null;
    setDiagramOpen(false);
  };
  const insertPlantUml = () => {
    const pos = pendingDiagramPos.current;
    if (pos != null) editor.commands.insertContentAt(pos, { type: "plantUmlBlock" });
    else editor.chain().focus().insertContent({ type: "plantUmlBlock" }).run();
    pendingDiagramPos.current = null;
    setDiagramOpen(false);
  };
  const insertDrawIo = () => {
    const pos = pendingDiagramPos.current;
    if (pos != null) editor.commands.insertContentAt(pos, { type: "drawIoBlock", attrs: { view: "edit" } });
    else editor.chain().focus().insertContent({ type: "drawIoBlock", attrs: { view: "edit" } }).run();
    pendingDiagramPos.current = null;
    setDiagramOpen(false);
  };
  const restoreSelection = (chain) =>
    savedSelection.current
      ? chain.setTextSelection(savedSelection.current)
      : chain;
  const setLink = () => {
    const previous = editor.getAttributes("link").href || "https://";
    const href = window.prompt("링크 주소", previous);
    if (href === null) return;
    if (!href.trim())
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else
      restoreSelection(editor.chain().focus())
        .extendMarkRange("link")
        .setLink({ href: href.trim() })
        .run();
  };
  const findNext = () => {
    if (!findText) return;
    const start = editor.state.selection.to;
    let hit = null;
    editor.state.doc.descendants((node, pos) => {
      if (hit || !node.isText) return;
      const index = node.text
        .toLocaleLowerCase()
        .indexOf(findText.toLocaleLowerCase(), Math.max(0, start - pos));
      if (index >= 0)
        hit = { from: pos + index, to: pos + index + findText.length };
    });
    if (!hit)
      editor.state.doc.descendants((node, pos) => {
        if (hit || !node.isText) return;
        const index = node.text
          .toLocaleLowerCase()
          .indexOf(findText.toLocaleLowerCase());
        if (index >= 0)
          hit = { from: pos + index, to: pos + index + findText.length };
      });
    if (hit)
      editor.chain().focus().setTextSelection(hit).scrollIntoView().run();
  };
  const replaceCurrent = () => {
    const { from, to } = editor.state.selection;
    if (from !== to && editor.state.doc.textBetween(from, to) === findText)
      editor.chain().focus().insertContent(replaceText).run();
    findNext();
  };
  const copyCode = () => {
    const { $from } = editor.state.selection;
    if ($from.parent.type.name === "codeBlock")
      navigator.clipboard.writeText($from.parent.textContent);
  };
  const beautifyCode = () => {
    const { $from } = editor.state.selection;
    if (
      $from.parent.type.name !== "codeBlock" ||
      $from.parent.attrs.language !== "json"
    )
      return;
    try {
      const formatted = JSON.stringify(
        JSON.parse($from.parent.textContent),
        null,
        2,
      );
      editor
        .chain()
        .focus()
        .selectParentNode()
        .insertContent({
          type: "codeBlock",
          attrs: { language: "json" },
          content: [{ type: "text", text: formatted }],
        })
        .run();
    } catch {
      window.alert("JSON 문법을 확인해 주세요.");
    }
  };
  const outline = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading")
      outline.push({
        level: node.attrs.level,
        text: node.textContent || "제목 없음",
        pos: pos + 1,
      });
  });
  const uploadImages = async (files) => {
    const images = await Promise.all(Array.from(files || []).map(readFileBlock));
    if (images.length) {
      if (pendingFilePos.current != null)
        editor.commands.insertContentAt(pendingFilePos.current, images);
      else editor.chain().focus().insertContent(images).run();
    }
    pendingFilePos.current = null;
    if (fileInput.current) fileInput.current.value = "";
  };
  const setClampedSplitRatio = (nextRatio) => {
    const ratio = Math.min(75, Math.max(25, nextRatio));
    setSplitRatio(ratio);
    window.localStorage.setItem("ksnote:editor-split-ratio", String(ratio));
  };
  const resizeSplitFromPointer = (clientX) => {
    const bounds = splitGroupRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    setClampedSplitRatio(((clientX - bounds.left) / bounds.width) * 100);
  };
  const handleSplitPointerDown = (event) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSplitResizing(true);
    resizeSplitFromPointer(event.clientX);
  };
  const handleSplitKeyDown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") setClampedSplitRatio(25);
    else if (event.key === "End") setClampedSplitRatio(75);
    else setClampedSplitRatio(splitRatio + (event.key === "ArrowLeft" ? -2 : 2));
  };
  const getTableRange = () => {
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--)
      if ($from.node(d).type.name === "table")
        return { from: $from.before(d), to: $from.after(d) };
    return null;
  };
  const currentTableElement = () => {
    const anchor = window.getSelection()?.anchorNode;
    return (anchor?.nodeType === 3 ? anchor.parentElement : anchor)?.closest?.("table") || null;
  };
  const copyTableFor = async (target) => {
    const table = currentTableElement();
    if (!table) return;
    if (target === "confluence") {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([table.outerHTML], { type: "text/html" }), "text/plain": new Blob([table.innerText], { type: "text/plain" }) })]);
      return;
    }
    const rows = Array.from(table.rows).map((row, rowIndex) => {
      const cells = Array.from(row.cells).map((cell) => cell.innerText.replace(/\r?\n/g, " "));
      return rowIndex === 0 ? `||${cells.join("||")}||` : `|${cells.join("|")}|`;
    });
    await navigator.clipboard.writeText(rows.join("\n"));
  };
  const moveTablePart = (kind, direction) => {
    const { $from } = editor.state.selection;
    let depth = -1;
    for (let index = $from.depth; index > 0; index--) {
      if ($from.node(index).type.name === "table") { depth = index; break; }
    }
    if (depth < 0) return;
    const table = $from.node(depth);
    const json = table.toJSON();
    if (kind === "row") {
      const index = $from.index(depth);
      const target = index + direction;
      if (target < 0 || target >= json.content.length) return;
      json.content.splice(target, 0, json.content.splice(index, 1)[0]);
    } else {
      const index = $from.index(depth + 1);
      const target = index + direction;
      const columnCount = json.content[0]?.content?.length || 0;
      if (target < 0 || target >= columnCount) return;
      json.content.forEach((row) => row.content?.splice(target, 0, row.content.splice(index, 1)[0]));
    }
    const from = $from.before(depth);
    editor.view.dispatch(editor.state.tr.replaceWith(from, from + table.nodeSize, editor.schema.nodeFromJSON(json)));
    editor.commands.focus();
  };
  const askAI = async (instruction = aiPrompt, targetOverride) => {
    if (!instruction.trim() || aiLoading) return;
    const { from, to } = editor.state.selection;
    const selection = editor.state.doc.textBetween(from, to, "\n");
    const activeContext = getActiveBlockContext(editor);
    const target =
      targetOverride ||
      (aiMode === "edit"
        ? wantsWholeNoteEdit(instruction)
          ? "note"
          : activeContext.target
        : "note");
    const range =
      target === "table"
        ? getTableRange()
        : target === activeContext.target
          ? activeContext.range
          : target === "selection"
            ? { from, to }
            : null;
    const originalHtml = editor.getHTML();
    const selectionHtml = serializeEditorRange(editor, range, selection);
    const operation =
      aiMode === "edit" && target !== "table"
        ? requestedEditOperation(instruction)
        : "replace";
    const editContext = {
      kind: target,
      nodeType:
        target === "table"
          ? "table"
          : target === "note"
            ? "doc"
            : activeContext.nodeType,
      label:
        target === "table"
          ? "현재 표"
          : target === "note"
            ? "전체 노트"
            : activeContext.label,
      cursorOffset: activeContext.cursorOffset ?? null,
      ancestors: activeContext.ancestors || [],
      html: target === "note" ? originalHtml : selectionHtml,
      text:
        target === "note"
          ? editor.state.doc.textContent
          : editor.state.doc.textBetween(range?.from || from, range?.to || to, "\n"),
      requestedOperation: operation,
    };
    const sourceRevision = contentRevision(originalHtml);
    const externalLinks = extractExternalLinks(`${instruction}\n${selection}`);
    const externalTargets = parseAtlassianTargets(externalLinks);
    const selectedModel =
      availableModels.find((model) => model.id === aiModel) ||
      availableModels[0];
    const provider = selectedModel?.provider || "codex";
    aiTargetRef.current = {
      target,
      range,
      originalHtml,
      operation,
      label: editContext.label,
    };
    let researchApprovedAt = null;
    if (aiMode === "research") {
      if (!window.confirm(`Atlassian Rovo 조사 모드로 실행합니다.\n\n전송 범위: 프롬프트, 현재 노트, 선택 영역\n감지된 대상: ${externalLinks.join(", ") || "링크 또는 이슈 키 없음"}\n\n읽기 전용 조회를 계속할까요?`)) return;
      researchApprovedAt = Date.now();
    }
    setAiOpen(true);
    setAiLoading(true);
    setAiError("");
    setAiResult(null);
    setAiStream("");
    setAiProgress({ stage: "preparing", startedAt: Date.now() });
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    aiRequestRef.current = requestId;
    writeAiDebugLog(requestId, { status: "running", noteId, projectId, provider, model: selectedModel?.id, mode: aiMode, target, prompt: instruction.trim(), selection, pageBefore: originalHtml, response: "" });
    writeAiAuditLog({ requestId, status: "running", provider, model: selectedModel?.id, mode: aiMode, target, sourceRevision, externalLinks, externalTargets, researchApprovedAt });
    const sessionBase = { id: requestId, sessionId: activeAiSessionId, noteId, projectId, instruction: instruction.trim(), mode: aiMode, provider, model: selectedModel?.id, target, sourceRevision, externalLinks, externalTargets, researchApprovedAt, createdAt: Date.now() };
    try {
      if (!window.ksnoteAI?.run)
        throw new Error(
          "데스크톱 앱에서 실행해야 AI CLI를 사용할 수 있습니다.",
        );
      setAiProgress((value) => ({ ...value, stage: "connecting" }));
      const runPromise = window.ksnoteAI.run({
        noteId,
        projectId,
        sessionId: activeAiSessionId,
        provider,
        model: selectedModel?.id,
        command: agentCommands[provider],
        mode: aiMode,
        instruction,
        content: aiMode === "edit" ? editContext.html : editor.getHTML(),
        noteContent: editor.getHTML(),
        selection,
        selectionHtml,
        editContext,
        requestedOperation: operation,
        sourceRevision,
        externalLinks,
        target,
        requestId,
      });
      window.setTimeout(() => {
        if (aiRequestRef.current === requestId)
          setAiProgress((value) =>
            value.stage === "connecting"
              ? { ...value, stage: "generating" }
              : value,
          );
      }, 700);
      const rawOutput = await runPromise;
      setAiProgress((value) => ({ ...value, stage: "preview" }));
      const patch = aiMode === "edit" ? parseAIPatch(rawOutput, target) : null;
      if (patch) patch.operation = operation;
      if (patch && target === "table")
        patch.html = preserveTableFormatting(selectionHtml, patch.html);
      const output = normalizeRichHtml(
        patch ? patch.html : rawOutput,
        { allowImages: false },
      );
      if (!output)
        throw new Error("AI 응답에 삽입할 수 있는 내용이 없습니다.");
      const sources = aiMode === "research"
        ? extractExternalLinks(`${rawOutput}\n${externalLinks.join("\n")}`)
        : [];
      setAiResult({
        output,
        patch,
        sources,
        instruction,
        mode: aiMode,
        target,
        originalHtml,
        beforeHtml: target === "note" ? originalHtml : selectionHtml,
        sourceRevision,
        requestId,
      });
      writeAiDebugLog(requestId, {
        status: "responded",
        rawResponse: rawOutput,
        response: output,
        responseVisible: true,
      });
      writeAiAuditLog({ requestId, status: "responded", sourceRevision, sources });
      setAiSessions((sessions) => [{ ...sessionBase, output, patch, sources, status: "done", respondedAt: Date.now() }, ...sessions].slice(0, 100));
    } catch (err) {
      const message = err.message || "AI 실행에 실패했습니다.";
      setAiError(message);
      writeAiDebugLog(requestId, { status: "error", error: message, responseVisible: false });
      writeAiAuditLog({ requestId, status: "error", sourceRevision, error: message });
      setAiSessions((sessions) => [{ ...sessionBase, error: message, status: "error" }, ...sessions].slice(0, 100));
    } finally {
      setAiLoading(false);
      aiRequestRef.current = null;
    }
  };
  const cancelAI = async () => {
    if (!aiRequestRef.current) return;
    await window.ksnoteAI?.cancel?.(aiRequestRef.current);
    writeAiDebugLog(aiRequestRef.current, { status: "cancelled", response: aiStream, responseVisible: Boolean(aiStream) });
    writeAiAuditLog({ requestId: aiRequestRef.current, status: "cancelled" });
    setAiLoading(false); setAiError("요청을 취소했습니다."); aiRequestRef.current = null;
  };
  const cleanAIHtml = (value) =>
    normalizeRichHtml(value, { allowImages: false });
  const openAISession = (session) => {
    setActiveAiSessionId(session.sessionId || session.id);
    setAiPrompt(session.instruction); setAiMode(session.mode); setAiModel(session.model || (session.provider === "claude" ? "sonnet" : preferredModel));
    setAiError(session.error || "");
    setAiResult(session.output ? { output: session.output, patch: session.patch, sources: session.sources || session.externalLinks || [], instruction: session.instruction, mode: session.mode, target: session.target, sourceRevision: session.sourceRevision, requestId: session.id, replay: true } : null);
    aiTargetRef.current = { target: session.target, range: null };
    setAiHistoryOpen(false);
  };
  const startNewAISession = () => {
    setActiveAiSessionId(
      `ai-session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    );
    setAiPrompt("");
    setAiResult(null);
    setAiError("");
    setAiStream("");
    setAiHistoryOpen(false);
  };
  const switchAiMode = (nextMode) => {
    if (nextMode !== aiMode) {
      setActiveAiSessionId(
        `ai-session-${noteId}-${nextMode}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      );
      setAiResult(null);
      setAiError("");
      setAiStream("");
    }
    setAiMode(nextMode);
  };
  const applyAI = (action = "replace") => {
    if (!aiResult) return;
    const target = aiTargetRef.current;
    const output = cleanAIHtml(aiResult.output);
    if (
      aiResult.mode === "ask" ||
      (aiResult.mode === "research" && action !== "replace") ||
      action === "insert"
    ) {
      editor
        .chain()
        .focus()
        .insertContent(`<blockquote>${output}</blockquote>`)
        .run();
    } else if (target?.target === "note") {
      if (target.originalHtml !== editor.getHTML()) { setAiError("AI 실행 후 노트가 변경되었습니다. 결과를 다시 요청하거나 노트에 삽입해 주세요."); return; }
      const operation = aiResult.patch?.operation || target.operation || "replace";
      if (operation === "insert_before")
        editor.chain().focus("start").insertContent(output).run();
      else if (operation === "insert_after")
        editor.chain().focus("end").insertContent(output).run();
      else {
        if (!window.confirm("AI 결과로 전체 노트를 교체합니다. 변경 내용은 Undo로 되돌릴 수 있습니다. 계속할까요?")) return;
        editor.commands.setContent(output);
      }
    } else if (target?.range) {
      if (target.originalHtml !== editor.getHTML()) { setAiError("선택 이후 노트가 변경되어 안전하게 적용할 수 없습니다. 결과를 다시 요청해 주세요."); return; }
      const operation = aiResult.patch?.operation || target.operation || "replace";
      if (operation === "insert_before")
        editor.chain().focus().insertContentAt(target.range.from, output).run();
      else if (operation === "insert_after")
        editor.chain().focus().insertContentAt(target.range.to, output).run();
      else editor.chain().focus().insertContentAt(target.range, output).run();
    }
    setAiResult(null);
    setAiPrompt("");
    const appliedRevision = contentRevision(editor.getHTML());
    writeAiDebugLog(aiResult.requestId, { status: "applied", applyAction: action, appliedRevision, pageAfter: editor.getHTML(), responseVisible: true });
    writeAiAuditLog({ requestId: aiResult.requestId, status: "applied", applyAction: action, sourceRevision: aiResult.sourceRevision, appliedRevision });
    window.ksnoteAI?.markApplied?.({
      requestId: aiResult.requestId,
      appliedRevision,
    });
    setAiSessions((sessions) => sessions.map((session) =>
      session.id === aiResult.requestId
        ? { ...session, status: "applied", applyAction: action, appliedRevision, appliedAt: Date.now() }
        : session,
    ));
  };
  return (
    <section
      className={`rich-document view-${mode} ${hideCompleted ? "hide-completed" : ""}`}
      ref={rootRef}
      style={{
        "--ks-editor-size": `${preferences.fontSize || 14}px`,
        "--ks-editor-font":
          preferences.fontFamily === "mono"
            ? "var(--mono)"
            : preferences.fontFamily === "system"
              ? "system-ui, sans-serif"
              : "var(--body)",
      }}
    >
      {mode !== "preview" && (
        <div
          className="rich-toolbar"
          onMouseDown={() => {
            const { from, to } = editor.state.selection;
            if (from !== to) savedSelection.current = { from, to };
          }}
        >
          <select
            aria-label="문단 스타일"
            value={
              editor.isActive("heading")
                ? `h${editor.getAttributes("heading").level}`
                : "p"
            }
            onChange={(e) =>
              e.target.value === "p"
                ? editor.chain().focus().setParagraph().run()
                : editor
                    .chain()
                    .focus()
                    .setHeading({ level: Number(e.target.value.slice(1)) })
                    .run()
            }
          >
            <option value="p">일반 텍스트</option>
            <option value="h1">제목 1</option>
            <option value="h2">제목 2</option>
            <option value="h3">제목 3</option>
            <option value="h4">제목 4</option>
            <option value="h5">제목 5</option>
            <option value="h6">제목 6</option>
          </select>
          <i />
          <button
            className={editor.isActive("bold") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title="굵게"
          >
            <Bold />
          </button>
          <button
            className={editor.isActive("italic") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title="기울임"
          >
            <Italic />
          </button>
          <button
            className={editor.isActive("underline") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title="밑줄"
          >
            <UnderlineIcon />
          </button>
          <button
            className={editor.isActive("strike") ? "active" : ""}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title="취소선"
          >
            <Strikethrough />
          </button>
          <div className="palette-menu">
            <button title="글자색">
              <Palette />
            </button>
            <div className="swatches">
              {colors.map((c) => (
                <button
                  key={c}
                  aria-label={`글자색 ${c}`}
                  style={{ background: c }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (inTable)
                      editor
                        .chain()
                        .focus()
                        .setCellAttribute("textColor", c)
                        .run();
                    else
                      restoreSelection(editor.chain().focus())
                        .setColor(c)
                        .run();
                  }}
                />
              ))}
            </div>
          </div>
          <button
            className={editor.isActive("link") ? "active" : ""}
            title="링크 삽입 또는 수정"
            onClick={setLink}
          >
            <Link2 />
          </button>
          <div className="palette-menu">
            <button title="배경색">
              <Highlighter />
            </button>
            <div className="swatches">
              {backgrounds.map((c) => (
                <button
                  key={c}
                  aria-label={`배경색 ${c}`}
                  style={{ background: c }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (inTable)
                      editor
                        .chain()
                        .focus()
                        .setCellAttribute("backgroundColor", c)
                        .run();
                    else
                      restoreSelection(editor.chain().focus())
                        .toggleHighlight({ color: c })
                        .run();
                  }}
                />
              ))}
            </div>
          </div>
          <i />
          <button
            onClick={() =>
              inTable
                ? editor
                    .chain()
                    .focus()
                    .setCellAttribute("textAlign", "left")
                    .run()
                : editor.chain().focus().setTextAlign("left").run()
            }
          >
            <AlignLeft />
          </button>
          <button
            onClick={() =>
              inTable
                ? editor
                    .chain()
                    .focus()
                    .setCellAttribute("textAlign", "center")
                    .run()
                : editor.chain().focus().setTextAlign("center").run()
            }
          >
            <AlignCenter />
          </button>
          <button
            onClick={() =>
              inTable
                ? editor
                    .chain()
                    .focus()
                    .setCellAttribute("textAlign", "right")
                    .run()
                : editor.chain().focus().setTextAlign("right").run()
            }
          >
            <AlignRight />
          </button>
          <i />
          <div className="table-insert">
            <button
              className={gridOpen ? "active" : ""}
              onClick={() => setGridOpen((v) => !v)}
            >
              <Table2 />
              <ChevronDown />
            </button>
            {gridOpen && <GridPicker onPick={insertTable} onClose={() => {}} />}
          </div>
          <button
            title="다이어그램 삽입"
            onClick={() => {
              pendingDiagramPos.current = editor.state.selection.from;
              setDiagramOpen(true);
            }}
          >
            <Workflow />
          </button>
          <button
            title="이미지, GIF 또는 파일 업로드"
            onClick={() => fileInput.current?.click()}
          >
            <ImageIcon />
          </button>
          <input
            ref={fileInput}
            className="image-file-input"
            type="file"
            multiple
            onChange={(e) => uploadImages(e.target.files)}
          />
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List />
          </button>
          <button
            className={editor.isActive("taskList") ? "active" : ""}
            title="할 일 목록"
            onClick={() => editor.chain().focus().toggleTaskList().run()}
          >
            <ListChecks />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
          >
            <Quote />
          </button>
          <span className="toolbar-spacer" />
          <button
            className={findOpen ? "active" : ""}
            title="찾기 및 바꾸기"
            onClick={() => setFindOpen((open) => !open)}
          >
            <Search />
          </button>
          <button
            className={outlineOpen ? "active" : ""}
            title="문서 목차"
            onClick={() => setOutlineOpen((open) => !open)}
          >
            <ListTree />
          </button>
          <button onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 />
          </button>
          <button onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 />
          </button>
        </div>
      )}
      {mode !== "preview" && findOpen && (
        <div className="find-bar">
          <Search />
          <input
            autoFocus
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") findNext();
            }}
            placeholder="찾을 내용"
          />
          <button onClick={findNext}>다음</button>
          <Replace />
          <input
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="바꿀 내용"
          />
          <button onClick={replaceCurrent}>바꾸기</button>
          <button onClick={() => setFindOpen(false)}>
            <X />
          </button>
        </div>
      )}
      {outlineOpen && (
        <aside className="document-outline">
          <header>
            <b>문서 목차</b>
            <button onClick={() => setOutlineOpen(false)}>
              <X />
            </button>
          </header>
          {outline.length ? (
            outline.map((item, index) => (
              <button
                key={`${item.pos}-${index}`}
                style={{ paddingLeft: 12 + (item.level - 1) * 10 }}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(item.pos)
                    .scrollIntoView()
                    .run()
                }
              >
                <span>H{item.level}</span>
                {item.text}
              </button>
            ))
          ) : (
            <p>제목을 추가하면 목차가 표시됩니다.</p>
          )}
        </aside>
      )}
      {mode !== "preview" && tableContextOpen && (
        <div className="table-context">
          <b>표</b>
          <span />
          <button onClick={() => editor.chain().focus().addRowBefore().run()}>
            <Plus /> 위에 행
          </button>
          <button onClick={() => editor.chain().focus().addRowAfter().run()}>
            <Plus /> 아래에 행
          </button>
          <button
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            <Plus /> 왼쪽 열
          </button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()}>
            <Plus /> 오른쪽 열
          </button>
          <span />
          <button onClick={() => editor.chain().focus().mergeCells().run()}>
            <Merge /> 셀 병합
          </button>
          <button onClick={() => editor.chain().focus().splitCell().run()}>
            <Split /> 셀 분할
          </button>
          <button title="Jira 호환 표 문법 복사" onClick={() => copyTableFor("jira")}><Copy /> Jira 복사</button>
          <button title="Confluence Rich Table 복사" onClick={() => copyTableFor("confluence")}><Copy /> Confluence 복사</button>
          <span />
          <button title="현재 행 위로 이동" onClick={() => moveTablePart("row", -1)}><ArrowUp /> 행</button>
          <button title="현재 행 아래로 이동" onClick={() => moveTablePart("row", 1)}><ArrowDown /> 행</button>
          <button title="현재 열 왼쪽 이동" onClick={() => moveTablePart("column", -1)}><ArrowLeft /> 열</button>
          <button title="현재 열 오른쪽 이동" onClick={() => moveTablePart("column", 1)}><ArrowRight /> 열</button>
          <span />
          <button
            className="danger"
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <Minus /> 행 삭제
          </button>
          <button
            className="danger"
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <Minus /> 열 삭제
          </button>
          <button
            className="danger"
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 /> 표 삭제
          </button>
          <form
            className="table-ai"
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.tablePrompt;
              askAI(input.value, "table");
              input.value = "";
            }}
          >
            <Sparkles />
            <input name="tablePrompt" placeholder="AI에게 이 표 정리 지시…" />
            <button>
              <Send />
            </button>
          </form>
        </div>
      )}
      {mode !== "preview" && inCode && (
        <div className="code-context">
          <b>코드</b>
          <select
            value={editor.getAttributes("codeBlock").language || "plaintext"}
            onChange={(e) =>
              editor
                .chain()
                .focus()
                .updateAttributes("codeBlock", { language: e.target.value })
                .run()
            }
          >
            <option value="plaintext">Plain text</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="json">JSON</option>
            <option value="python">Python</option>
            <option value="csharp">C#</option>
            <option value="cpp">C++</option>
            <option value="sql">SQL</option>
            <option value="xml">XML</option>
            <option value="yaml">YAML</option>
          </select>
          <button onClick={copyCode}>
            <Copy /> 복사
          </button>
          <button
            onClick={beautifyCode}
            disabled={editor.getAttributes("codeBlock").language !== "json"}
          >
            JSON 정렬
          </button>
          <button onClick={() => editor.chain().focus().updateAttributes("codeBlock", { collapsed: !editor.getAttributes("codeBlock").collapsed }).run()}>
            <FoldVertical /> {editor.getAttributes("codeBlock").collapsed ? "펼치기" : "접기"}
          </button>
          <span>→ 키로 블록 나가기</span>
        </div>
      )}
      {mode !== "preview" && inTask && (
        <div className="task-context">
          <b>할 일</b>
          <label>마감 <input type="date" value={taskAttrs.dueDate || ""} onChange={(e) => editor.chain().focus().updateAttributes("taskItem", { dueDate: e.target.value }).run()} /></label>
          <label>담당자 <input value={taskAttrs.assignee || ""} placeholder="이름" onChange={(e) => editor.chain().focus().updateAttributes("taskItem", { assignee: e.target.value }).run()} /></label>
          <label>우선순위 <select value={taskAttrs.priority || "normal"} onChange={(e) => editor.chain().focus().updateAttributes("taskItem", { priority: e.target.value }).run()}><option value="low">낮음</option><option value="normal">보통</option><option value="high">높음</option></select></label>
          <button onClick={() => setHideCompleted((value) => !value)}>{hideCompleted ? "완료 표시" : "완료 숨기기"}</button>
        </div>
      )}
      <div
        ref={splitGroupRef}
        className={`rich-canvas-group ${splitResizing ? "is-resizing" : ""}`}
        style={mode === "split" ? { "--editor-split-ratio": `${splitRatio}%` } : undefined}
      >
        <div className="rich-canvas">
          {mode !== "preview" && (
            <DragHandle editor={editor} nested className="block-drag-handle">
              <GripVertical />
            </DragHandle>
          )}
          <EditorContent editor={editor} />
        </div>
        {mode === "split" && (
          <div
            className="split-resize-handle"
            role="separator"
            aria-label="편집기와 미리보기 너비 조절"
            aria-orientation="vertical"
            aria-valuemin="25"
            aria-valuemax="75"
            aria-valuenow={Math.round(splitRatio)}
            tabIndex="0"
            onDoubleClick={() => setClampedSplitRatio(50)}
            onKeyDown={handleSplitKeyDown}
            onPointerDown={handleSplitPointerDown}
            onPointerMove={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                resizeSplitFromPointer(event.clientX);
            }}
            onPointerUp={(event) => {
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              setSplitResizing(false);
            }}
            onPointerCancel={() => setSplitResizing(false)}
          >
            <span />
          </div>
        )}
        {mode === "split" && <RichPreview html={previewHtml} />}
      </div>
      {slash && (
        <div
          className="rich-slash-menu"
          style={{ left: slash.left, top: slash.top }}
        >
          <header>
            <b>블록 추가</b>
            <span>{slash.query ? `/${slash.query}` : "입력해서 검색"}</span>
          </header>
          <div>
            {filtered.length ? (
              filtered.map((item, i) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={i === slashIndex ? "active" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      runSlash(item);
                    }}
                    onMouseEnter={() => setSlashIndex(i)}
                  >
                    <i>
                      <Icon />
                    </i>
                    <span>
                      <b>{item.label}</b>
                      <small>{item.description}</small>
                    </span>
                    <kbd>{item.command}</kbd>
                  </button>
                );
              })
            ) : (
              <p>일치하는 명령이 없습니다</p>
            )}
          </div>
          <footer>
            <span>
              <kbd>↑</kbd>
              <kbd>↓</kbd> 이동
            </span>
            <span>
              <kbd>Enter</kbd> 선택
            </span>
            <span>
              <kbd>Esc</kbd> 닫기
            </span>
          </footer>
        </div>
      )}
      {diagramOpen && (
        <div
          className="diagram-picker-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDiagramOpen(false);
          }}
        >
          <section className="diagram-picker">
            <header>
              <span>
                <Workflow />
                <span>
                  <b>다이어그램 삽입</b>
                  <small>소스와 결과를 한 블록에서 편집합니다.</small>
                </span>
              </span>
              <button onClick={() => setDiagramOpen(false)}>
                <X />
              </button>
            </header>
            <div>
              <button
                className="diagram-choice primary"
                onClick={insertMermaid}
              >
                <span className="diagram-choice-icon">M</span>
                <span>
                  <b>Mermaid</b>
                  <small>
                    순서도, 시퀀스, 클래스, ERD · 앱 안에서 바로 렌더링
                  </small>
                </span>
                <em>사용 가능</em>
              </button>
              <button className="diagram-choice" onClick={insertPlantUml}>
                <span className="diagram-choice-icon plantuml">P</span>
                <span>
                  <b>PlantUML</b>
                  <small>Java 또는 PlantUML 서버 경로가 필요합니다.</small>
                </span>
                <em>로컬 JAR</em>
              </button>
              <button className="diagram-choice" onClick={insertDrawIo}>
                <span className="diagram-choice-icon drawio">D</span>
                <span>
                  <b>draw.io</b>
                  <small>diagrams.net 편집창을 노트 블록 안에서 엽니다.</small>
                </span>
                <em>Editor</em>
              </button>
            </div>
            <footer>
              <code>/diagram</code>은 형식을 선택하고, <code>/mermaid</code>,
              <code>/plantuml</code>, <code>/draw_edit</code>는 바로 삽입합니다.
            </footer>
          </section>
        </div>
      )}
      <div className={`ai-dock ${aiOpen ? "open" : ""}`}>
        {aiOpen && (
          <div className="ai-panel">
            <header>
              <span>
                <Sparkles />
                <b>KsNote AI</b>
                <small>노트 내용을 읽고 편집할 수 있습니다</small>
              </span>
              <nav className="ai-header-actions">
                <button title="새 요청" onClick={startNewAISession}><Plus /></button>
                <button title="Prompt 세션" className={aiHistoryOpen ? "active" : ""} onClick={() => setAiHistoryOpen((value) => !value)}><History /></button>
                <button title="닫기" onClick={() => setAiOpen(false)}><X /></button>
              </nav>
            </header>
            {aiHistoryOpen && (
              <section className="ai-session-panel" aria-label="AI Prompt 세션 목록">
                <div className="ai-session-heading"><b>AI 대화</b><small>{visibleAiConversations.length}개</small><button className={aiSessionScope === "note" ? "active" : ""} onClick={() => setAiSessionScope("note")}>현재 노트</button><button className={aiSessionScope === "project" ? "active" : ""} onClick={() => setAiSessionScope("project")}>프로젝트</button></div>
                {visibleAiConversations.length === 0 ? <p className="ai-session-empty">저장된 AI 대화가 아직 없습니다.</p> : (
                  <div className="ai-session-list">{visibleAiConversations.map((session) => {
                    const usage = session.usage;
                    const contextTokens = usage?.last?.inputTokens || 0;
                    const cumulativeTokens = usage?.total?.totalTokens || 0;
                    const contextWindow = usage?.modelContextWindow || 0;
                    const contextPercent = contextWindow
                      ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
                      : 0;
                    return (
                    <article key={session.sessionId} className="ai-session-item">
                      <button className="ai-session-main" onClick={() => openAISession(session)}>
                        <span className={`ai-session-status ${session.status}`} />
                        <span>
                          <b>{session.title}</b>
                          <small>{availableModels.find((model) => model.id === session.model)?.label || session.model || (session.provider === "codex" ? "Codex 기본 모델" : "Claude 기본 모델")} · {session.turnCount}턴 · 컨텍스트 {contextTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({contextPercent}%) · 누적 {cumulativeTokens.toLocaleString()}</small>
                          <i className="ai-context-meter"><i style={{ width: `${contextPercent}%` }} /></i>
                        </span>
                      </button>
                      <button className="ai-session-action" title="대화 이름 변경" onClick={async () => {
                        const title = window.prompt("대화 이름", session.title);
                        if (!title?.trim()) return;
                        await window.ksnoteAI?.renameSession?.({ sessionId: session.sessionId, title });
                        setAiSessionMeta((items) => items.map((item) =>
                          item.id === session.sessionId ? { ...item, title: title.trim() } : item,
                        ));
                      }}><FilePenLine /></button>
                      <button className="ai-session-action" title="지금 요약하고 새 컨텍스트로 분기" onClick={async () => {
                        if (!window.confirm("현재 대화를 요약한 뒤 더 가벼운 새 컨텍스트로 이어갈까요? 원래 대화 기록은 보존됩니다.")) return;
                        try {
                          await window.ksnoteAI?.compactSession?.(session.sessionId);
                          setAiUsageBySession((current) => ({
                            ...current,
                            [session.sessionId]: { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, modelContextWindow: 0 },
                          }));
                        } catch (error) { setAiError(error.message); }
                      }}><RotateCcw /></button>
                      <button className="ai-session-action warning" title="컨텍스트 초기화" onClick={async () => {
                        if (!window.confirm("이 대화의 AI 컨텍스트와 Turn 기록을 지울까요? 대화 이름은 유지됩니다.")) return;
                        await window.ksnoteAI?.resetContext?.(session.sessionId);
                        setAiSessions((sessions) => sessions.filter(
                          (item) => (item.sessionId || item.id) !== session.sessionId,
                        ));
                        setAiUsageBySession((current) => ({ ...current, [session.sessionId]: { total: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, modelContextWindow: 0 } }));
                        if (activeAiSessionId === session.sessionId) startNewAISession();
                      }}><Eraser /></button>
                      <button className="ai-session-delete" title="대화 삭제" onClick={() => {
                        const sessionId = session.sessionId || session.id;
                        if (!window.confirm("대화와 저장된 모든 기록을 영구 삭제할까요?")) return;
                        window.ksnoteAI?.deleteSession?.(sessionId);
                        setAiSessions((sessions) => sessions.filter(
                          (item) => (item.sessionId || item.id) !== sessionId,
                        ));
                        setAiSessionMeta((items) => items.filter((item) => item.id !== sessionId));
                        if (activeAiSessionId === sessionId) startNewAISession();
                      }}><Trash2 /></button>
                    </article>
                  );})}</div>
                )}
              </section>
            )}
            {(aiResult || aiError || aiLoading) && (
              <div className="ai-response">
                {aiLoading && (
                  <>
                    <div className="ai-thinking">
                      <LoaderCircle />
                      <span>
                        <b>
                          {{
                            preparing: "편집 대상을 분석하고 있습니다",
                            connecting: `${availableModels.find((model) => model.id === aiModel)?.label || aiModel}에 연결하고 있습니다`,
                            generating:
                              aiMode === "research"
                                ? "Atlassian 자료를 조사하고 있습니다"
                                : "응답을 생성하고 있습니다",
                            receiving: "응답을 받아 미리보기를 만들고 있습니다",
                            preview: "변경 내용을 렌더링하고 있습니다",
                          }[aiProgress.stage] || "AI 작업을 준비하고 있습니다"}
                        </b>
                        <small>{(aiElapsed / 1000).toFixed(1)}초 · {aiTargetRef.current?.label || "현재 문서"}</small>
                      </span>
                      <button className="ai-cancel-run" onClick={cancelAI}><Square /> 중지</button>
                    </div>
                    <div className="ai-progress-track" aria-label="AI 작업 진행 상태">
                      <i className={`stage-${aiProgress.stage}`} />
                    </div>
                    <div className="ai-progress-steps">
                      <span className={["preparing", "connecting", "generating", "receiving", "preview"].includes(aiProgress.stage) ? "active" : ""}>대상 분석</span>
                      <span className={["connecting", "generating", "receiving", "preview"].includes(aiProgress.stage) ? "active" : ""}>모델 연결</span>
                      <span className={["generating", "receiving", "preview"].includes(aiProgress.stage) ? "active" : ""}>생성</span>
                      <span className={["receiving", "preview"].includes(aiProgress.stage) ? "active" : ""}>응답 수신</span>
                    </div>
                    {aiStream && <div className="ai-stream-text">{aiStream}</div>}
                  </>
                )}
                {aiError && <div className="ai-error">{aiError}</div>}
                {aiResult && (
                  <>
                    {!aiResult.replay && (
                      <div className="ai-quick-actions">
                        {aiResult.mode === "edit" && <button className="apply" onClick={() => applyAI("replace")}><Check /> 변경 적용</button>}
                        <button onClick={() => applyAI("insert")}><FilePenLine /> 커서에 삽입</button>
                        <button onClick={() => setAiResult(null)}><X /> 닫기</button>
                      </div>
                    )}
                    {aiResult.mode === "edit" && !aiResult.replay && (
                      <div className="ai-diff">
                        <section>
                          <b>변경 전</b>
                          <div
                            className="ai-diff-preview"
                            dangerouslySetInnerHTML={{
                              __html: cleanAIHtml(aiResult.beforeHtml || aiResult.originalHtml),
                            }}
                          />
                        </section>
                        <section>
                          <b>변경 후</b>
                          <div
                            className="ai-diff-preview"
                            dangerouslySetInnerHTML={{
                              __html: cleanAIHtml(aiResult.output),
                            }}
                          />
                        </section>
                      </div>
                    )}
                    <div
                      className="ai-result-text ai-result-rendered"
                      dangerouslySetInnerHTML={{
                        __html: cleanAIHtml(aiResult.output),
                      }}
                    />
                    {aiResult.patch?.summary && (
                      <p className="ai-patch-summary">{aiResult.patch.summary}</p>
                    )}
                    {aiResult.sources?.length > 0 && (
                      <div className="ai-source-list">
                        <b>조회 출처</b>
                        {aiResult.sources.map((source) =>
                          /^https?:/i.test(source) ? (
                            <a key={source} href={source} target="_blank" rel="noreferrer">{source}</a>
                          ) : (
                            <span key={source}>{source}</span>
                          ),
                        )}
                        <small>{new Date().toLocaleString("ko-KR")} 조회</small>
                      </div>
                    )}
                    <div className="ai-result-actions">
                      {aiResult.mode === "edit" && !aiResult.replay && (
                        <button
                          className="apply"
                          onClick={() => applyAI("replace")}
                        >
                          <Check /> 변경 적용
                        </button>
                      )}
                      {aiResult.mode === "research" && aiResult.target === "selection" && !aiResult.replay && (
                        <button
                          className="apply"
                          onClick={() => applyAI("replace")}
                        >
                          <Check /> 선택 영역 교체
                        </button>
                      )}
                      <button onClick={() => applyAI("insert")}>
                        <FilePenLine /> 노트에 삽입
                      </button>
                      <button onClick={() => setAiResult(null)}>
                        <X /> 취소
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <form
              className="ai-compose"
              onSubmit={(e) => {
                e.preventDefault();
                askAI();
              }}
            >
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={
                  aiMode === "edit"
                    ? "예: 이 노트를 3줄로 요약하고 표로 정리해줘"
                    : aiMode === "research" ? "Confluence 또는 Jira 링크를 붙여 넣고 조사할 내용을 적어주세요" : "예: 이 문서의 핵심 결정 사항이 뭐야?"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    askAI();
                  }
                }}
              />
              {detectedPromptLinks.length > 0 && aiMode !== "research" && (
                <button
                  type="button"
                  className="ai-research-suggestion"
                  onClick={() => {
                    switchAiMode("research");
                    const codexModel = availableModels.find((model) => model.provider === "codex");
                    if (codexModel) setAiModel(codexModel.id);
                  }}
                >
                  <Globe2 />
                  Atlassian 링크 또는 이슈 키를 감지했습니다. Rovo 조사로 전환
                </button>
              )}
              <div>
                <span className="ai-modes">
                  <button
                    type="button"
                    className={aiMode === "edit" ? "active" : ""}
                    onClick={() => switchAiMode("edit")}
                  >
                    <FilePenLine /> 노트 편집
                  </button>
                  <button
                    type="button"
                    className={aiMode === "ask" ? "active" : ""}
                    onClick={() => switchAiMode("ask")}
                  >
                    <MessageSquare /> 질문
                  </button>
                  <button type="button" className={aiMode === "research" ? "active research" : ""} onClick={() => { switchAiMode("research"); const codexModel = availableModels.find((model) => model.provider === "codex"); if (codexModel) setAiModel(codexModel.id); }}><Globe2 /> Rovo 조사</button>
                </span>
                <select
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  aria-label="AI 모델 선택"
                >
                  <optgroup label="OpenAI">
                    {availableModels.filter((model) => model.provider === "codex").map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Anthropic">
                    {availableModels.filter((model) => model.provider === "claude").map((model) => (
                      <option key={model.id} value={model.id}>{model.label}</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  className="ai-send"
                  disabled={!aiPrompt.trim() || aiLoading}
                >
                  <Send />
                </button>
              </div>
            </form>
          </div>
        )}
        <button className="ai-toggle" onClick={() => setAiOpen((v) => !v)}>
          <Sparkles />
          <span>
            <b>AI에게 요청</b>
            <small>요약 · 정리 · 질문 · 노트 편집</small>
          </span>
          <ChevronUp className={aiOpen ? "rotated" : ""} />
        </button>
      </div>
    </section>
  );
}
