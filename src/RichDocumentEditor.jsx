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
} from "lucide-react";
import "./rich-editor.css";
import "./palette-fix.css";
import "./slash-rich.css";
import "./image-block.css";
import "./ai-dock.css";
import "./code-block.css";
import "./mermaid-block.css";
import "./view-modes.css";
import "./preview-mermaid.css";
import "./task-list.css";
import "./editor-tools.css";
import "./code-tools.css";
import "./outline.css";
import "./diagram-picker.css";

const lowlight = createLowlight(common);

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
  const preview = useRef(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    let live = true;
    mermaid
      .render(`ks-mermaid-${id}`, node.attrs.code)
      .then(({ svg }) => {
        if (live && preview.current) {
          preview.current.innerHTML = svg;
          setSvgOutput(svg);
          setError("");
        }
      })
      .catch((err) => {
        if (live)
          setError(err.message?.split("\n")[0] || "Mermaid 문법을 확인하세요");
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
            {error ? <p>{error}</p> : <div ref={preview} />}
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

const asHtml = (value) =>
  /^\s*</.test(value || "") ? value : marked.parse(value || "");

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
  content,
  mode = "edit",
  preferredProvider = "codex",
  agentCommands = { codex: "codex", claude: "claude" },
  preferences = { fontSize: 14, fontFamily: "sans", spellcheck: false },
  onChange,
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
  const [aiOpen, setAiOpen] = useState(false),
    [aiMode, setAiMode] = useState("edit"),
    [aiPrompt, setAiPrompt] = useState(""),
    [aiProvider, setAiProvider] = useState(preferredProvider),
    [aiLoading, setAiLoading] = useState(false),
    [aiResult, setAiResult] = useState(null),
    [aiError, setAiError] = useState("");
  const aiTargetRef = useRef(null);
  useEffect(() => setAiProvider(preferredProvider), [preferredProvider]);
  const slashCommands = [
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
      description: "Mermaid 또는 PlantUML 형식 선택",
      icon: Workflow,
      keywords: "diagram 다이어그램 mermaid plantuml uml",
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
    if (item.id === "diagram" || item.id === "plantuml") {
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
    let chain = editor
      .chain()
      .focus()
      .deleteRange({ from: current.from, to: current.to });
    if (item.id === "table")
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
    else if (item.id === "code") chain.setCodeBlock();
    else if (item.id === "mermaid")
      chain.insertContent({ type: "mermaidBlock" });
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false, link: false }),
      SmartCodeBlock.configure({ lowlight, defaultLanguage: "plaintext" }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage.configure({ allowBase64: true, inline: false }),
      AttachmentBlock,
      MermaidBlock,
      PlantUmlBlock,
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
          const text = $from.parent.textContent.trim().toLowerCase();
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
      const html = editor.getHTML();
      setPreviewHtml(html);
      onChange(html);
      detectSlash(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      const { from, to } = editor.state.selection;
      if (from !== to) savedSelection.current = { from, to };
      detectSlash(editor);
    },
  });
  useEffect(() => {
    if (editor) {
      const incoming = asHtml(content);
      setPreviewHtml(incoming);
      if (editor.getHTML() !== incoming)
        editor.commands.setContent(incoming, false);
    }
  }, [noteId]);
  useEffect(() => {
    if (editor) editor.setEditable(mode !== "preview");
  }, [editor, mode]);
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute(
      "spellcheck",
      preferences.spellcheck ? "true" : "false",
    );
  }, [editor, preferences.spellcheck]);
  useEffect(() => {
    if (!editor) return;
    const updateLineNumbers = () => editor.view.dom.querySelectorAll("pre").forEach((pre) => {
      const count = Math.max(1, (pre.querySelector("code")?.textContent || "").split("\n").length);
      pre.setAttribute("data-line-numbers", Array.from({ length: count }, (_, index) => index + 1).join("\n"));
    });
    updateLineNumbers();
    editor.on("update", updateLineNumbers);
    return () => editor.off("update", updateLineNumbers);
  }, [editor]);
  if (!editor) return null;
  const inTable = editor.isActive("table");
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
    const target = targetOverride || (from !== to ? "selection" : "note");
    const range =
      target === "table"
        ? getTableRange()
        : target === "selection"
          ? { from, to }
          : null;
    aiTargetRef.current = { target, range };
    setAiOpen(true);
    setAiLoading(true);
    setAiError("");
    setAiResult(null);
    try {
      if (!window.ksnoteAI?.run)
        throw new Error(
          "데스크톱 앱에서 실행해야 AI CLI를 사용할 수 있습니다.",
        );
      const output = await window.ksnoteAI.run({
        provider: aiProvider,
        command: agentCommands[aiProvider],
        mode: aiMode,
        instruction,
        content: editor.getHTML(),
        selection,
        target,
      });
      setAiResult({ output, instruction, mode: aiMode, target });
    } catch (err) {
      setAiError(err.message || "AI 실행에 실패했습니다.");
    } finally {
      setAiLoading(false);
    }
  };
  const cleanAIHtml = (value) =>
    value
      .replace(/^```(?:html)?\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
  const applyAI = (action = "replace") => {
    if (!aiResult) return;
    const target = aiTargetRef.current;
    const output = cleanAIHtml(aiResult.output);
    if (aiResult.mode === "ask" || action === "insert") {
      editor
        .chain()
        .focus()
        .insertContent(
          `<blockquote><p>${output.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p></blockquote>`,
        )
        .run();
    } else if (target?.target === "note") {
      editor.commands.setContent(output);
    } else if (target?.range) {
      editor.chain().focus().insertContentAt(target.range, output).run();
    }
    setAiResult(null);
    setAiPrompt("");
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
      {mode !== "preview" && inTable && (
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
      <div className="rich-canvas-group">
        <div className="rich-canvas">
          {mode !== "preview" && (
            <DragHandle editor={editor} nested className="block-drag-handle">
              <GripVertical />
            </DragHandle>
          )}
          <EditorContent editor={editor} />
        </div>
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
            </div>
            <footer>
              <code>/diagram</code>은 형식을 선택하고, <code>/mermaid</code>는
              바로 삽입합니다.
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
              <button onClick={() => setAiOpen(false)}>
                <X />
              </button>
            </header>
            {(aiResult || aiError || aiLoading) && (
              <div className="ai-response">
                {aiLoading && (
                  <div className="ai-thinking">
                    <LoaderCircle />{" "}
                    {aiProvider === "codex" ? "Codex" : "Claude"}가 노트를 읽고
                    있습니다…
                  </div>
                )}
                {aiError && <div className="ai-error">{aiError}</div>}
                {aiResult && (
                  <>
                    <div className="ai-result-text">{aiResult.output}</div>
                    <div className="ai-result-actions">
                      {aiResult.mode === "edit" && (
                        <button
                          className="apply"
                          onClick={() => applyAI("replace")}
                        >
                          <Check /> 변경 적용
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
                    : "예: 이 문서의 핵심 결정 사항이 뭐야?"
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    askAI();
                  }
                }}
              />
              <div>
                <span className="ai-modes">
                  <button
                    type="button"
                    className={aiMode === "edit" ? "active" : ""}
                    onClick={() => setAiMode("edit")}
                  >
                    <FilePenLine /> 노트 편집
                  </button>
                  <button
                    type="button"
                    className={aiMode === "ask" ? "active" : ""}
                    onClick={() => setAiMode("ask")}
                  >
                    <MessageSquare /> 질문
                  </button>
                </span>
                <select
                  value={aiProvider}
                  onChange={(e) => setAiProvider(e.target.value)}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude</option>
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
