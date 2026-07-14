import React, { useEffect, useId, useRef, useState } from "react";
import {
  useEditor,
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react";
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
} from "lucide-react";
import "./rich-editor.css";
import "./palette-fix.css";
import "./slash-rich.css";
import "./image-block.css";
import "./ai-dock.css";
import "./code-block.css";
import "./mermaid-block.css";
import "./view-modes.css";
import "./diagram-picker.css";

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
    };
  },
});

function ResizableImageView({ node, selected, updateAttributes }) {
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
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
});
function MermaidView({ node, selected, updateAttributes, deleteNode }) {
  const [mode, setMode] = useState("split"),
    [error, setError] = useState("");
  const preview = useRef(null);
  const id = useId().replace(/:/g, "");
  useEffect(() => {
    let live = true;
    mermaid
      .render(`ks-mermaid-${id}`, node.attrs.code)
      .then(({ svg }) => {
        if (live && preview.current) {
          preview.current.innerHTML = svg;
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
const readImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        type: "image",
        attrs: {
          src: reader.result,
          alt: file.name || "이미지",
          title: file.name || null,
        },
      });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

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
    else if (item.id === "h1") chain.setHeading({ level: 1 });
    else if (item.id === "h2") chain.setHeading({ level: 2 });
    else if (item.id === "bullet") chain.toggleBulletList();
    else if (item.id === "number") chain.toggleOrderedList();
    else if (item.id === "quote") chain.toggleBlockquote();
    else if (item.id === "divider") chain.setHorizontalRule();
    else chain.setParagraph();
    chain.run();
    setSlash(null);
  };
  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      ResizableImage.configure({ allowBase64: true, inline: false }),
      MermaidBlock,
      Table.configure({ resizable: true, allowTableNodeSelection: true }),
      TableRow,
      StyledHeader,
      StyledCell,
    ],
    content: asHtml(content),
    editorProps: {
      attributes: { class: "mori-rich-content" },
      handlePaste(view, event) {
        const files = Array.from(event.clipboardData?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        const text = event.clipboardData?.getData("text/plain")?.trim() || "";
        if (
          !files.length &&
          /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie)\b/m.test(
            text,
          )
        ) {
          event.preventDefault();
          editor
            ?.chain()
            .focus()
            .insertContent({ type: "mermaidBlock", attrs: { code: text } })
            .run();
          return true;
        }
        if (!files.length) return false;
        event.preventDefault();
        const insertPos = view.state.selection.from;
        Promise.all(files.map(readImage)).then((images) => {
          editor?.commands.insertContentAt(insertPos, images);
          editor?.commands.focus();
        });
        return true;
      },
      handleDrop(view, event) {
        const files = Array.from(event.dataTransfer?.files || []).filter(
          (file) => file.type.startsWith("image/"),
        );
        if (!files.length) return false;
        event.preventDefault();
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          view.state.selection.from;
        Promise.all(files.map(readImage)).then((images) =>
          editor?.commands.insertContentAt(pos, images),
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
  if (!editor) return null;
  const inTable = editor.isActive("table");
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
  const restoreSelection = (chain) =>
    savedSelection.current
      ? chain.setTextSelection(savedSelection.current)
      : chain;
  const uploadImages = async (files) => {
    const images = await Promise.all(
      Array.from(files || [])
        .filter((file) => file.type.startsWith("image/"))
        .map(readImage),
    );
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
    <section className={`rich-document view-${mode}`} ref={rootRef}>
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
              editor.isActive("heading", { level: 1 })
                ? "h1"
                : editor.isActive("heading", { level: 2 })
                  ? "h2"
                  : "p"
            }
            onChange={(e) =>
              e.target.value === "h1"
                ? editor.chain().focus().toggleHeading({ level: 1 }).run()
                : e.target.value === "h2"
                  ? editor.chain().focus().toggleHeading({ level: 2 }).run()
                  : editor.chain().focus().setParagraph().run()
            }
          >
            <option value="p">일반 텍스트</option>
            <option value="h1">제목 1</option>
            <option value="h2">제목 2</option>
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
                    restoreSelection(editor.chain().focus()).setColor(c).run();
                  }}
                />
              ))}
            </div>
          </div>
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
            onClick={() => editor.chain().focus().setTextAlign("left").run()}
          >
            <AlignLeft />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("center").run()}
          >
            <AlignCenter />
          </button>
          <button
            onClick={() => editor.chain().focus().setTextAlign("right").run()}
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
            title="이미지 또는 GIF 업로드"
            onClick={() => fileInput.current?.click()}
          >
            <ImageIcon />
          </button>
          <input
            ref={fileInput}
            className="image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={(e) => uploadImages(e.target.files)}
          />
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List />
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
          <button onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 />
          </button>
          <button onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 />
          </button>
        </div>
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
      <div className="rich-canvas-group">
        <div className="rich-canvas">
          <EditorContent editor={editor} />
        </div>
        {mode === "split" && (
          <article
            className="split-preview"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        )}
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
              <button className="diagram-choice" disabled>
                <span className="diagram-choice-icon plantuml">P</span>
                <span>
                  <b>PlantUML</b>
                  <small>Java 또는 PlantUML 서버 경로가 필요합니다.</small>
                </span>
                <em>다음 단계</em>
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
