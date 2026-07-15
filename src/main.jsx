import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { marked } from "marked";
import mermaid from "mermaid";
import hljs from "highlight.js";
import {
  Search,
  Plus,
  FileText,
  Folder,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Columns2,
  Eye,
  Pencil,
  Download,
  Copy,
  Check,
  Code2,
  Table2,
  Image as ImageIcon,
  Workflow,
  ChevronRight,
  ChevronsUpDown,
  Undo2,
  Redo2,
  Command,
  X,
  Heading1,
  Heading2,
  List,
  ListChecks,
  Quote,
  Minus,
  Braces,
  Pilcrow,
  Bold,
  Italic,
  Strikethrough,
  Underline,
  Palette,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link,
  Settings,
  Plug,
  Keyboard,
  Database,
  Shield,
  Monitor,
  ExternalLink,
  Server,
  Trash2,
  SlidersHorizontal,
  Bot,
  Terminal,
} from "lucide-react";
import "highlight.js/styles/github.css";
import "./styles.css";
import "./slash.css";
import "./settings.css";
import "./settings-agent.css";
import "./table.css";
import RichDocumentEditor from "./RichDocumentEditor";
import "./editor-migration.css";
import "./project-manager.css";
import "./workspace-menu.css";
import "./page-actions.css";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
  fontFamily: "Pretendard, sans-serif",
});
marked.setOptions({
  breaks: true,
  gfm: true,
  highlight(code, lang) {
    return lang && hljs.getLanguage(lang)
      ? hljs.highlight(code, { language: lang }).value
      : hljs.highlightAuto(code).value;
  },
});

const starter = {
  projects: [
    { id: "p1", name: "AI 작업 공간", color: "#147d72" },
    { id: "p2", name: "Unity", color: "#e57b58" },
  ],
  notes: [
    {
      id: "n1",
      projectId: "p1",
      title: "MVP 1 설계",
      updatedAt: Date.now(),
      content: `# MVP 1 설계\n\n붙여넣기만 하면 문서가 제자리를 찾는 **로컬 우선 스마트 노트**입니다.\n\n## 핵심 경험\n\n- Markdown을 그대로 붙여넣고 즉시 미리보기\n- 코드는 자동으로 언어를 감지하고 정리\n- CSV·Excel 데이터는 편집 가능한 표로 변환\n- Mermaid는 소스와 다이어그램을 함께 관리\n\n\`\`\`javascript\nfunction smartPaste(clipboard) {\n  return detect(clipboard).toBlock()\n}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\n  Paste[Ctrl + V] --> Detect{내용 감지}\n  Detect --> Code\n  Detect --> Table\n  Detect --> Diagram\n\`\`\`\n`,
    },
    {
      id: "n2",
      projectId: "p1",
      title: "Smart Paste 규칙",
      updatedAt: Date.now() - 86400000,
      content:
        "# Smart Paste 규칙\n\n클립보드 MIME 타입과 텍스트 패턴을 함께 확인합니다.",
    },
    {
      id: "n3",
      projectId: "p1",
      title: "에디터 조사",
      updatedAt: Date.now() - 172800000,
      content:
        "# 에디터 조사\n\n블록과 Markdown 사이의 왕복 변환을 우선 검증합니다.",
    },
    {
      id: "n4",
      projectId: "p2",
      title: "Timeline 줌 버그",
      updatedAt: Date.now() - 260000000,
      content: "# Timeline 줌 버그\n\n재현 조건과 로그를 기록합니다.",
    },
  ],
};

const loadData = () => {
  try {
    return JSON.parse(localStorage.getItem("mori-data")) || starter;
  } catch {
    return starter;
  }
};
const uid = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const slashCommands = [
  {
    id: "text",
    aliases: ["text", "paragraph", "텍스트", "문단"],
    label: "텍스트",
    description: "일반 문단을 시작합니다",
    icon: Pilcrow,
    template: "",
  },
  {
    id: "heading1",
    aliases: ["h1", "heading", "제목", "큰제목"],
    label: "제목 1",
    description: "큰 섹션 제목을 추가합니다",
    icon: Heading1,
    template: "# 제목",
  },
  {
    id: "heading2",
    aliases: ["h2", "heading2", "소제목"],
    label: "제목 2",
    description: "중간 섹션 제목을 추가합니다",
    icon: Heading2,
    template: "## 제목",
  },
  {
    id: "table",
    aliases: ["table", "표", "테이블"],
    label: "표",
    description: "편집 가능한 3열 표를 추가합니다",
    icon: Table2,
    template:
      "| 항목 | 내용 | 상태 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |",
  },
  {
    id: "code",
    aliases: ["code", "코드", "snippet"],
    label: "코드 블록",
    description: "언어를 지정할 수 있는 코드 영역",
    icon: Code2,
    template: "```javascript\n// 코드를 입력하세요\n\n```",
    cursorBack: 4,
  },
  {
    id: "mermaid",
    aliases: ["mermaid", "diagram", "다이어그램"],
    label: "Mermaid 다이어그램",
    description: "소스와 미리보기가 연결된 다이어그램",
    icon: Workflow,
    template: "```mermaid\nflowchart LR\n  A[시작] --> B[완료]\n```",
  },
  {
    id: "json",
    aliases: ["json", "제이슨"],
    label: "JSON",
    description: "정렬된 JSON 코드 블록",
    icon: Braces,
    template: '```json\n{\n  "key": "value"\n}\n```',
  },
  {
    id: "bullet",
    aliases: ["list", "bullet", "목록"],
    label: "글머리 목록",
    description: "순서 없는 목록을 추가합니다",
    icon: List,
    template: "- 첫 번째 항목\n- 두 번째 항목",
  },
  {
    id: "checklist",
    aliases: ["check", "todo", "체크", "할일"],
    label: "체크리스트",
    description: "완료 여부를 표시하는 목록",
    icon: ListChecks,
    template: "- [ ] 할 일\n- [ ] 할 일",
  },
  {
    id: "quote",
    aliases: ["quote", "인용"],
    label: "인용문",
    description: "중요한 문장을 강조합니다",
    icon: Quote,
    template: "> 인용문을 입력하세요",
  },
  {
    id: "divider",
    aliases: ["divider", "line", "구분선"],
    label: "구분선",
    description: "내용 사이를 나눕니다",
    icon: Minus,
    template: "---",
  },
  {
    id: "image",
    aliases: ["image", "이미지", "사진"],
    label: "이미지",
    description: "이미지 주소와 설명을 입력합니다",
    icon: ImageIcon,
    template: "![이미지 설명](이미지 주소)",
  },
];

function detectPaste(text, files) {
  if (files?.length && files[0].type.startsWith("image/"))
    return { type: "image", label: "이미지" };
  const t = text.trim();
  if (/^@startuml/i.test(t)) return { type: "plantuml", label: "PlantUML" };
  if (
    /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie)\b/m.test(
      t,
    )
  )
    return { type: "mermaid", label: "Mermaid" };
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return { type: "json", label: "JSON" };
    } catch {}
  }
  const rows = t.split("\n").filter(Boolean);
  if (
    rows.length > 1 &&
    (rows.every((r) => r.includes("\t")) || rows.every((r) => r.includes(",")))
  )
    return { type: "table", label: "표" };
  if (/^#{1,6}\s|^[-*]\s|```|\|.+\|/m.test(t))
    return { type: "markdown", label: "Markdown" };
  if (
    /\b(function|class|const|let|public|private|def|import|SELECT|CREATE)\b|[{};]\s*$/m.test(
      t,
    )
  )
    return { type: "code", label: "코드" };
  return { type: "text", label: "텍스트" };
}

function Diagram({ code, id }) {
  const ref = useRef(null);
  useEffect(() => {
    let live = true;
    mermaid
      .render(`m-${id.replace(/[^a-z0-9]/gi, "")}`, code)
      .then(({ svg }) => {
        if (live && ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => {
        if (ref.current)
          ref.current.innerHTML =
            '<p class="diagram-error">다이어그램 문법을 확인해 주세요.</p>';
      });
    return () => {
      live = false;
    };
  }, [code, id]);
  return <div ref={ref} className="diagram" />;
}

function Preview({ content }) {
  const parts = useMemo(() => {
    const out = [];
    let last = 0;
    const re = /```mermaid\s*\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(content))) {
      if (m.index > last)
        out.push({ type: "md", value: content.slice(last, m.index) });
      out.push({ type: "mermaid", value: m[1] });
      last = re.lastIndex;
    }
    if (last < content.length)
      out.push({ type: "md", value: content.slice(last) });
    return out;
  }, [content]);
  return (
    <article className="preview">
      {parts.map((p, i) =>
        p.type === "mermaid" ? (
          <Diagram key={i} id={`d${i}`} code={p.value} />
        ) : (
          <div
            key={i}
            dangerouslySetInnerHTML={{ __html: marked.parse(p.value) }}
          />
        ),
      )}
    </article>
  );
}

function TableDesigner({ onCancel, onInsert }) {
  const [stage, setStage] = useState("pick"),
    [dragging, setDragging] = useState(false),
    [pick, setPick] = useState({ r: 3, c: 3 });
  const [rows, setRows] = useState(3),
    [cols, setCols] = useState(3),
    [cells, setCells] = useState([]),
    [anchor, setAnchor] = useState(null),
    [focus, setFocus] = useState(null);
  const makeCells = (r, c) =>
    Array.from({ length: r }, (_, ri) =>
      Array.from({ length: c }, (_, ci) => ({
        text: ri === 0 ? `제목 ${ci + 1}` : "",
        bg: ri === 0 ? "#eef3f3" : "#ffffff",
        color: "#263638",
        align: "left",
        bold: ri === 0,
      })),
    );
  const beginEdit = () => {
    setRows(pick.r);
    setCols(pick.c);
    setCells(makeCells(pick.r, pick.c));
    setStage("edit");
  };
  const selected = (r, c) =>
    anchor &&
    focus &&
    r >= Math.min(anchor.r, focus.r) &&
    r <= Math.max(anchor.r, focus.r) &&
    c >= Math.min(anchor.c, focus.c) &&
    c <= Math.max(anchor.c, focus.c);
  const updateSelected = (patch) =>
    setCells((old) =>
      old.map((row, r) =>
        row.map((cell, c) => (selected(r, c) ? { ...cell, ...patch } : cell)),
      ),
    );
  const changeText = (r, c, text) =>
    setCells((old) =>
      old.map((row, ri) =>
        row.map((cell, ci) =>
          ri === r && ci === c ? { ...cell, text } : cell,
        ),
      ),
    );
  const resize = (nr, nc) => {
    setCells((old) =>
      Array.from({ length: nr }, (_, r) =>
        Array.from(
          { length: nc },
          (_, c) =>
            old[r]?.[c] || {
              text: "",
              bg: "#ffffff",
              color: "#263638",
              align: "left",
              bold: false,
            },
        ),
      ),
    );
    setRows(nr);
    setCols(nc);
  };
  const finish = () =>
    onInsert(
      `<table class="mori-table"><tbody>${cells.map((row) => `<tr>${row.map((cell) => `<td style="background:${cell.bg};color:${cell.color};text-align:${cell.align};font-weight:${cell.bold ? "700" : "400"}">${cell.text || "&nbsp;"}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
    );
  return (
    <div className="modal-backdrop table-backdrop">
      <section className={`table-designer ${stage}`}>
        <header>
          <div>
            <span className="table-mark">
              <Table2 />
            </span>
            <span>
              <h2>{stage === "pick" ? "표 크기 선택" : "표 편집"}</h2>
              <p>
                {stage === "pick"
                  ? "마우스로 드래그해 행과 열을 선택하세요"
                  : "셀 또는 범위를 선택하고 내용을 편집하세요"}
              </p>
            </span>
          </div>
          <button className="icon-btn" onClick={onCancel}>
            <X />
          </button>
        </header>
        {stage === "pick" ? (
          <div className="grid-stage">
            <div className="grid-size">
              <b>
                {pick.r} × {pick.c}
              </b>
              <span>
                {pick.r}행 {pick.c}열
              </span>
            </div>
            <div
              className="grid-picker"
              onMouseLeave={() => setDragging(false)}
            >
              {Array.from({ length: 8 }, (_, r) =>
                Array.from({ length: 8 }, (_, c) => (
                  <button
                    key={`${r}-${c}`}
                    className={r < pick.r && c < pick.c ? "selected" : ""}
                    onMouseDown={() => {
                      setDragging(true);
                      setPick({ r: r + 1, c: c + 1 });
                    }}
                    onMouseEnter={() => {
                      if (dragging) setPick({ r: r + 1, c: c + 1 });
                    }}
                    onMouseUp={() => {
                      setDragging(false);
                      setPick({ r: r + 1, c: c + 1 });
                    }}
                    aria-label={`${r + 1}행 ${c + 1}열`}
                  />
                )),
              )}
            </div>
            <p>클릭하거나 누른 채 드래그해 최대 8 × 8 표를 만들 수 있습니다.</p>
          </div>
        ) : (
          <>
            <div className="table-tools">
              <button className="active">
                <Table2 /> 셀
              </button>
              <span />
              <button
                title="굵게"
                onClick={() => updateSelected({ bold: true })}
              >
                <Bold />
              </button>
              <label title="글자색">
                <Palette />
                <input
                  type="color"
                  defaultValue="#263638"
                  onChange={(e) => updateSelected({ color: e.target.value })}
                />
              </label>
              <label title="배경색">
                <Highlighter />
                <input
                  type="color"
                  defaultValue="#fff4c2"
                  onChange={(e) => updateSelected({ bg: e.target.value })}
                />
              </label>
              <span />
              <button
                title="왼쪽 정렬"
                onClick={() => updateSelected({ align: "left" })}
              >
                <AlignLeft />
              </button>
              <button
                title="가운데 정렬"
                onClick={() => updateSelected({ align: "center" })}
              >
                <AlignCenter />
              </button>
              <button
                title="오른쪽 정렬"
                onClick={() => updateSelected({ align: "right" })}
              >
                <AlignRight />
              </button>
              <span />
              <button onClick={() => resize(rows + 1, cols)}>
                <Plus /> 행
              </button>
              <button onClick={() => resize(rows, cols + 1)}>
                <Plus /> 열
              </button>
              <button
                disabled={rows <= 1}
                onClick={() => resize(rows - 1, cols)}
              >
                <Minus /> 행
              </button>
              <button
                disabled={cols <= 1}
                onClick={() => resize(rows, cols - 1)}
              >
                <Minus /> 열
              </button>
            </div>
            <div className="table-workarea">
              <div className="table-selection-label">
                {anchor && focus
                  ? `${Math.abs(focus.r - anchor.r) + 1}행 × ${Math.abs(focus.c - anchor.c) + 1}열 선택됨`
                  : "셀을 선택하세요"}
              </div>
              <table
                className="visual-table"
                onMouseLeave={() => setDragging(false)}
              >
                <tbody>
                  {cells.map((row, r) => (
                    <tr key={r}>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          className={selected(r, c) ? "selected" : ""}
                          style={{
                            background: cell.bg,
                            color: cell.color,
                            textAlign: cell.align,
                            fontWeight: cell.bold ? 700 : 400,
                          }}
                          onMouseDown={() => {
                            setDragging(true);
                            setAnchor({ r, c });
                            setFocus({ r, c });
                          }}
                          onMouseEnter={() => {
                            if (dragging) setFocus({ r, c });
                          }}
                          onMouseUp={() => setDragging(false)}
                        >
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            onInput={(e) =>
                              changeText(r, c, e.currentTarget.textContent)
                            }
                          >
                            {cell.text}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <footer>
          <span>
            {stage === "pick"
              ? "표 크기는 나중에도 변경할 수 있습니다."
              : `${rows}행 × ${cols}열 · ${rows * cols}개 셀`}
          </span>
          <div>
            <button
              className="secondary"
              onClick={stage === "pick" ? onCancel : () => setStage("pick")}
            >
              {stage === "pick" ? "취소" : "이전"}
            </button>
            <button
              className="primary"
              onClick={stage === "pick" ? beginEdit : finish}
            >
              {stage === "pick" ? "표 만들기" : "문서에 삽입"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

function App() {
  const [data, setData] = useState(loadData);
  const [projectId, setProjectId] = useState("p1");
  const [noteId, setNoteId] = useState("n1");
  const [mode, setMode] = useState("split");
  const [leftOpen, setLeftOpen] = useState(true);
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(true);
  const [toast, setToast] = useState(null);
  const [copied, setCopied] = useState(false);
  const [slash, setSlash] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [tableOpen, setTableOpen] = useState(false);
  const tableInsertPos = useRef(null);
  const [projectDialog, setProjectDialog] = useState(null);
  const [projectMenu, setProjectMenu] = useState(null);
  const [prefs, setPrefs] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("mori-prefs")) || {
          theme: "light",
          fontSize: 14,
          fontFamily: "mono",
          spellcheck: false,
        }
      );
    } catch {
      return {
        theme: "light",
        fontSize: 14,
        fontFamily: "mono",
        spellcheck: false,
      };
    }
  });
  const [agents, setAgents] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("ksnote-agents")) || {
          defaultProvider: "codex",
          codex: { enabled: true, command: "codex" },
          claude: { enabled: false, command: "claude" },
        }
      );
    } catch {
      return {
        defaultProvider: "codex",
        codex: { enabled: true, command: "codex" },
        claude: { enabled: false, command: "claude" },
      };
    }
  });
  const [mcpServers, setMcpServers] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("mori-mcp")) || [
          {
            id: "filesystem",
            name: "Filesystem",
            command: "npx @modelcontextprotocol/server-filesystem",
            enabled: true,
            status: "ready",
          },
          {
            id: "github",
            name: "GitHub",
            command: "npx @modelcontextprotocol/server-github",
            enabled: false,
            status: "offline",
          },
        ]
      );
    } catch {
      return [];
    }
  });
  const textarea = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const note = data.notes.find((n) => n.id === noteId) || data.notes[0];
  const notes = data.notes
    .filter(
      (n) =>
        n.projectId === projectId &&
        n.title.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      localStorage.setItem("mori-data", JSON.stringify(data));
      setSaved(true);
    }, 350);
    return () => clearTimeout(t);
  }, [data]);
  useEffect(() => {
    localStorage.setItem("mori-prefs", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    localStorage.setItem("ksnote-agents", JSON.stringify(agents));
  }, [agents]);
  useEffect(() => {
    localStorage.setItem("mori-mcp", JSON.stringify(mcpServers));
  }, [mcpServers]);
  useEffect(() => {
    if (!accountMenuOpen) return;
    const close = (event) => {
      if (!accountMenuRef.current?.contains(event.target))
        setAccountMenuOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape") setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [accountMenuOpen]);
  const openSettings = (tab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setAccountMenuOpen(false);
    setMoreOpen(false);
  };
  const updateNote = (patch, history = true) =>
    setData((d) => ({
      ...d,
      notes: d.notes.map((n) => {
        if (n.id !== noteId) return n;
        if (
          history &&
          patch.content !== undefined &&
          patch.content !== n.content
        ) {
          undoStack.current.push(n.content);
          if (undoStack.current.length > 100) undoStack.current.shift();
          redoStack.current = [];
        }
        return { ...n, ...patch, updatedAt: Date.now() };
      }),
    }));
  const addNote = (targetProjectId = projectId) => {
    if (!targetProjectId) return;
    const n = {
      id: uid("n"),
      projectId: targetProjectId,
      title: "제목 없는 노트",
      content: "<h1>제목 없는 노트</h1><p></p>",
      updatedAt: Date.now(),
    };
    setData((d) => ({ ...d, notes: [n, ...d.notes] }));
    setProjectId(targetProjectId);
    setNoteId(n.id);
  };
  const addProject = () =>
    setProjectDialog({ type: "create", name: "새 프로젝트" });
  const saveProject = () => {
    const name = projectDialog?.name.trim();
    if (!name) return;
    if (projectDialog.type === "create") {
      const p = { id: uid("p"), name, color: "#69757d" };
      const n = {
        id: uid("n"),
        projectId: p.id,
        title: "제목 없는 노트",
        content: "<h1>제목 없는 노트</h1><p></p>",
        updatedAt: Date.now(),
      };
      setData((d) => ({
        ...d,
        projects: [...d.projects, p],
        notes: [n, ...d.notes],
      }));
      setProjectId(p.id);
      setNoteId(n.id);
    } else
      setData((d) => ({
        ...d,
        projects: d.projects.map((p) =>
          p.id === projectDialog.id ? { ...p, name } : p,
        ),
      }));
    setProjectDialog(null);
  };
  const deleteProject = () => {
    const id = projectDialog.id;
    const remaining = data.projects.filter((p) => p.id !== id);
    const next = remaining[0];
    const nextNote = data.notes.find((n) => n.projectId === next?.id);
    setData((d) => ({
      ...d,
      projects: d.projects.filter((p) => p.id !== id),
      notes: d.notes.filter((n) => n.projectId !== id),
    }));
    if (projectId === id) {
      setProjectId(next?.id || "");
      setNoteId(nextNote?.id || "");
    }
    setProjectDialog(null);
    setProjectMenu(null);
  };
  const doUndo = () => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current.pop();
    redoStack.current.push(note.content);
    updateNote({ content: prev }, false);
  };
  const doRedo = () => {
    if (!redoStack.current.length) return;
    const next = redoStack.current.pop();
    undoStack.current.push(note.content);
    updateNote({ content: next }, false);
  };
  const showToast = (message, icon) => {
    setToast({ message, icon });
    setTimeout(() => setToast(null), 2600);
  };
  const onPaste = (e) => {
    const files = e.clipboardData.files;
    const text = e.clipboardData.getData("text/plain");
    const hit = detectPaste(text, files);
    if (hit.type === "image") {
      e.preventDefault();
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const insert = `\n![붙여넣은 이미지](${reader.result})\n`;
        insertAtCursor(insert);
        showToast("이미지를 노트에 저장했습니다", "image");
      };
      reader.readAsDataURL(file);
      return;
    }
    if (hit.type === "json") {
      e.preventDefault();
      insertAtCursor(
        `\n\`\`\`json\n${JSON.stringify(JSON.parse(text), null, 2)}\n\`\`\`\n`,
      );
      showToast("JSON을 정리했습니다", "code");
    } else if (hit.type === "mermaid") {
      e.preventDefault();
      insertAtCursor(`\n\`\`\`mermaid\n${text.trim()}\n\`\`\`\n`);
      showToast("Mermaid 다이어그램으로 변환했습니다", "diagram");
    } else if (hit.type === "plantuml") {
      e.preventDefault();
      insertAtCursor(`\n\`\`\`plantuml\n${text.trim()}\n\`\`\`\n`);
      showToast("PlantUML 블록으로 변환했습니다", "diagram");
    } else if (hit.type === "table" && !/^\|/.test(text.trim())) {
      e.preventDefault();
      const sep = text.includes("\t") ? "\t" : ",";
      const rows = text
        .trim()
        .split(/\r?\n/)
        .map((r) => r.split(sep));
      const md = `\n| ${rows[0].join(" | ")} |\n| ${rows[0].map(() => "---").join(" | ")} |\n${rows
        .slice(1)
        .map((r) => `| ${r.join(" | ")} |`)
        .join("\n")}\n`;
      insertAtCursor(md);
      showToast("표로 변환했습니다", "table");
    } else if (hit.type === "code" && !text.includes("```")) {
      e.preventDefault();
      insertAtCursor(`\n\`\`\`\n${text.trim()}\n\`\`\`\n`);
      showToast("코드 블록으로 변환했습니다", "code");
    }
  };
  const insertAtCursor = (value) => {
    const el = textarea.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    updateNote({
      content: note.content.slice(0, start) + value + note.content.slice(end),
    });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + value.length;
    });
  };
  const slashResults = useMemo(() => {
    if (!slash) return [];
    const q = slash.query.toLowerCase();
    return slashCommands
      .filter(
        (c) =>
          !q ||
          c.label.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.includes(q)),
      )
      .slice(0, 8);
  }, [slash]);
  const trackSlash = (value, cursor) => {
    const before = value.slice(0, cursor);
    const match = before.match(/(?:^|\n)\/(\S*)$/);
    if (match) {
      const line = before.split("\n").length - 1;
      setSlash({
        query: match[1],
        start: cursor - match[1].length - 1,
        top: Math.min(310, 62 + line * 25 - (textarea.current?.scrollTop || 0)),
      });
      setSlashIndex(0);
    } else setSlash(null);
  };
  const chooseSlash = (command) => {
    if (!slash || !command) return;
    if (command.id === "table") {
      tableInsertPos.current = slash.start;
      updateNote({
        content:
          note.content.slice(0, slash.start) +
          note.content.slice(textarea.current.selectionStart),
      });
      setSlash(null);
      setTableOpen(true);
      return;
    }
    const before = note.content.slice(0, slash.start),
      after = note.content.slice(textarea.current.selectionStart);
    const needsBreak = before && !before.endsWith("\n");
    const insertion = `${needsBreak ? "\n" : ""}${command.template}${command.template ? "\n" : ""}`;
    updateNote({ content: before + insertion + after });
    setSlash(null);
    showToast(
      `${command.label} 블록을 추가했습니다`,
      command.id === "image"
        ? "image"
        : command.id === "mermaid"
          ? "diagram"
          : "code",
    );
    requestAnimationFrame(() => {
      const pos = before.length + insertion.length - (command.cursorBack || 0);
      textarea.current.focus();
      textarea.current.selectionStart = textarea.current.selectionEnd = pos;
    });
  };
  const onEditorKeyDown = (e) => {
    if (slash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, slashResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && slashResults.length) {
        e.preventDefault();
        chooseSlash(slashResults[slashIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSlash(null);
      }
    }
  };
  const formatSelection = (before, after = before) => {
    const el = textarea.current;
    if (!el) return;
    const start = el.selectionStart,
      end = el.selectionEnd;
    const selected = note.content.slice(start, end) || "텍스트";
    const next =
      note.content.slice(0, start) +
      before +
      selected +
      after +
      note.content.slice(end);
    updateNote({ content: next });
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = start + before.length;
      el.selectionEnd = start + before.length + selected.length;
    });
  };
  const insertBlock = (template) => {
    if (template.startsWith("| 항목")) {
      openTable();
      return;
    }
    insertAtCursor(`\n${template}\n`);
  };
  const openTable = () => {
    tableInsertPos.current =
      textarea.current?.selectionStart ?? note.content.length;
    setTableOpen(true);
  };
  const insertVisualTable = (html) => {
    const pos = tableInsertPos.current ?? note.content.length;
    updateNote({
      content:
        note.content.slice(0, pos) + `\n${html}\n` + note.content.slice(pos),
    });
    setTableOpen(false);
    showToast("표를 문서에 삽입했습니다", "table");
  };
  const addMcpServer = () =>
    setMcpServers((s) => [
      ...s,
      {
        id: uid("mcp"),
        name: "새 MCP 서버",
        command: "npx",
        args: "server-command",
        enabled: false,
        status: "offline",
      },
    ]);
  if (!note)
    return (
      <div className="empty">
        <div className="empty-mark">K</div>
        <h2>
          {data.projects.length
            ? "첫 노트를 만들어 보세요"
            : "첫 프로젝트를 만들어 보세요"}
        </h2>
        <button
          onClick={() =>
            data.projects.length
              ? addNote(projectId || data.projects[0]?.id)
              : addProject()
          }
        >
          <Plus size={16} />
          {data.projects.length ? "새 노트" : "새 프로젝트"}
        </button>
        {projectDialog && (
          <div className="modal-backdrop project-dialog-backdrop">
            <section className="project-dialog">
              <header>
                <span className="project-dialog-icon">
                  <Folder />
                </span>
                <span>
                  <h3>새 프로젝트</h3>
                  <p>노트와 자료를 묶는 작업 공간입니다.</p>
                </span>
              </header>
              <div className="project-name-field">
                <label>프로젝트 이름</label>
                <input
                  autoFocus
                  value={projectDialog.name}
                  onChange={(e) =>
                    setProjectDialog({ ...projectDialog, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProject();
                  }}
                />
              </div>
              <footer>
                <button
                  className="secondary"
                  onClick={() => setProjectDialog(null)}
                >
                  취소
                </button>
                <button className="primary" onClick={saveProject}>
                  프로젝트 만들기
                </button>
              </footer>
            </section>
          </div>
        )}
      </div>
    );
  return (
    <div className="app">
      {leftOpen && (
        <aside className="rail">
          <div className="brand">
            <span className="brand-mark">K</span>
            <span>KsNote</span>
            <button
              className="icon-btn collapse"
              onClick={() => setLeftOpen(false)}
              title="사이드바 닫기"
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <button className="new-note" onClick={() => addNote(projectId)}>
            <Plus size={17} /> 새 페이지 <kbd>⌘ N</kbd>
          </button>
          <label className="search">
            <Search size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="노트 검색"
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="rail-label">
            <span>프로젝트</span>
            <button onClick={addProject}>
              <Plus size={14} />
            </button>
          </div>
          <nav className="projects">
            {data.projects.map((p) => (
              <div
                className={`project-row ${p.id === projectId ? "active" : ""}`}
                key={p.id}
              >
                <button
                  className="project-main"
                  onClick={() => {
                    setProjectId(p.id);
                    const first = data.notes.find((n) => n.projectId === p.id);
                    setNoteId(first?.id || "");
                  }}
                >
                  <span
                    className="project-dot"
                    style={{ background: p.color }}
                  />
                  <span>{p.name}</span>
                  <span className="count">
                    {data.notes.filter((n) => n.projectId === p.id).length}
                  </span>
                </button>
                <button
                  className="project-more"
                  aria-label={`${p.name} 프로젝트 메뉴`}
                  onClick={() =>
                    setProjectMenu(projectMenu === p.id ? null : p.id)
                  }
                >
                  <MoreHorizontal size={14} />
                </button>
                {projectMenu === p.id && (
                  <div className="project-popover">
                    <button
                      onClick={() => {
                        addNote(p.id);
                        setProjectMenu(null);
                      }}
                    >
                      <Plus /> 페이지 추가
                    </button>
                    <button
                      onClick={() => {
                        setProjectDialog({
                          type: "rename",
                          id: p.id,
                          name: p.name,
                        });
                        setProjectMenu(null);
                      }}
                    >
                      <Pencil /> 이름 변경
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setProjectDialog({
                          type: "delete",
                          id: p.id,
                          name: p.name,
                        });
                        setProjectMenu(null);
                      }}
                    >
                      <Trash2 /> 프로젝트 삭제
                    </button>
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="rail-label notes-label">
            <span>페이지</span>
            <span className="page-label-actions">
              <ChevronsUpDown size={13} />
              <button
                onClick={() => addNote(projectId)}
                title="현재 프로젝트에 페이지 추가"
                aria-label="현재 프로젝트에 페이지 추가"
              >
                <Plus size={14} />
              </button>
            </span>
          </div>
          <nav className="notes">
            {notes.map((n) => (
              <button
                key={n.id}
                className={n.id === noteId ? "active" : ""}
                onClick={() => setNoteId(n.id)}
              >
                <FileText size={15} />
                <span>
                  <b>{n.title}</b>
                  <small>
                    {new Date(n.updatedAt).toLocaleDateString("ko-KR", {
                      month: "short",
                      day: "numeric",
                    })}
                  </small>
                </span>
              </button>
            ))}
          </nav>
          <div className="account" ref={accountMenuRef}>
            <span className="avatar">TO</span>
            <span>
              <b>로컬 작업 공간</b>
              <small>이 기기에 안전하게 저장</small>
            </span>
            <button
              className={`account-more ${accountMenuOpen ? "active" : ""}`}
              onClick={() => setAccountMenuOpen((open) => !open)}
              aria-label="작업 공간 메뉴"
              aria-expanded={accountMenuOpen}
            >
              <MoreHorizontal size={16} />
            </button>
            {accountMenuOpen && (
              <div className="workspace-menu">
                <header>
                  <span className="workspace-menu-avatar">TO</span>
                  <span>
                    <b>로컬 작업 공간</b>
                    <small>KsNote · 이 기기</small>
                  </span>
                </header>
                <div className="workspace-menu-section">
                  <button onClick={() => openSettings("general")}>
                    <Settings />
                    <span>
                      <b>설정</b>
                      <small>화면, 언어 및 시작 동작</small>
                    </span>
                  </button>
                  <button onClick={() => openSettings("agent")}>
                    <Bot />
                    <span>
                      <b>AI Agent</b>
                      <small>
                        {agents.defaultProvider === "codex"
                          ? "Codex"
                          : "Claude"}
                        를 기본으로 사용
                      </small>
                    </span>
                  </button>
                  <button onClick={() => openSettings("mcp")}>
                    <Plug />
                    <span>
                      <b>MCP 연결</b>
                      <small>
                        {mcpServers.filter((server) => server.enabled).length}개
                        서버 활성
                      </small>
                    </span>
                  </button>
                </div>
                <div className="workspace-menu-section compact">
                  <button onClick={() => openSettings("data")}>
                    <Database />
                    <span>
                      <b>데이터 및 저장소</b>
                    </span>
                  </button>
                  <button onClick={() => openSettings("security")}>
                    <Shield />
                    <span>
                      <b>보안 및 실행 권한</b>
                    </span>
                  </button>
                </div>
                <footer>
                  <span className="status-dot" /> 모든 데이터는 로컬에
                  저장됩니다.
                </footer>
              </div>
            )}
          </div>
        </aside>
      )}
      <main className="workspace">
        <header className="topbar">
          <div className="crumb">
            {!leftOpen && (
              <button className="icon-btn" onClick={() => setLeftOpen(true)}>
                <PanelLeftOpen size={18} />
              </button>
            )}
            <Folder size={15} />
            <span>{data.projects.find((p) => p.id === projectId)?.name}</span>
            <ChevronRight size={14} />
            <strong>{note.title}</strong>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saved ? "saved" : ""}`}>
              <span />
              {saved ? "저장됨" : "저장 중"}
            </span>
            <button className="icon-btn" onClick={doUndo} title="실행 취소">
              <Undo2 size={16} />
            </button>
            <button className="icon-btn" onClick={doRedo} title="다시 실행">
              <Redo2 size={16} />
            </button>
            <div className="view-toggle">
              <button
                className={mode === "edit" ? "active" : ""}
                onClick={() => setMode("edit")}
              >
                <Pencil size={14} /> 편집
              </button>
              <button
                className={mode === "split" ? "active" : ""}
                onClick={() => setMode("split")}
              >
                <Columns2 size={14} /> 분할
              </button>
              <button
                className={mode === "preview" ? "active" : ""}
                onClick={() => setMode("preview")}
              >
                <Eye size={14} /> 보기
              </button>
            </div>
            <button
              className="icon-btn"
              onClick={() =>
                window.mori?.exportNote({
                  title: note.title,
                  content: note.content,
                })
              }
              title="Markdown 내보내기"
            >
              <Download size={17} />
            </button>
            <div className="more-wrap">
              <button
                className={`icon-btn ${moreOpen ? "active" : ""}`}
                onClick={() => setMoreOpen((v) => !v)}
                aria-label="더 보기"
              >
                <MoreHorizontal size={18} />
              </button>
              {moreOpen && (
                <div className="more-menu">
                  <button
                    onClick={() => {
                      setSettingsOpen(true);
                      setSettingsTab("general");
                      setMoreOpen(false);
                    }}
                  >
                    <Settings />
                    <span>
                      <b>설정</b>
                      <small>작업 공간과 편집기</small>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setSettingsOpen(true);
                      setSettingsTab("agent");
                      setMoreOpen(false);
                    }}
                  >
                    <Bot />
                    <span>
                      <b>AI Agent</b>
                      <small>
                        {agents.defaultProvider === "codex"
                          ? "Codex"
                          : "Claude"}{" "}
                        기본 사용
                      </small>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setSettingsOpen(true);
                      setSettingsTab("mcp");
                      setMoreOpen(false);
                    }}
                  >
                    <Plug />
                    <span>
                      <b>MCP 연결</b>
                      <small>
                        {mcpServers.filter((s) => s.enabled).length}개 활성
                      </small>
                    </span>
                  </button>
                  <div />
                  <button
                    onClick={() =>
                      window.mori?.exportNote({
                        title: note.title,
                        content: note.content,
                      })
                    }
                  >
                    <Download />
                    <span>
                      <b>내보내기</b>
                      <small>Markdown 파일</small>
                    </span>
                  </button>
                  <button>
                    <Keyboard />
                    <span>
                      <b>키보드 단축키</b>
                      <small>빠른 작업 보기</small>
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <section className="title-area">
          <input
            value={note.title}
            onChange={(e) => updateNote({ title: e.target.value }, false)}
          />
          <div>
            <span>{note.content.trim().split(/\s+/).length}단어</span>
            <span>•</span>
            <span>
              {new Date(note.updatedAt).toLocaleTimeString("ko-KR", {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              수정
            </span>
          </div>
        </section>
        {mode !== "preview" && (
          <div className="formatbar">
            <select
              aria-label="문단 스타일"
              onChange={(e) => insertBlock(e.target.value)}
              defaultValue=""
            >
              <option value="" disabled>
                일반 텍스트
              </option>
              <option value="# 제목">제목 1</option>
              <option value="## 제목">제목 2</option>
              <option value="### 제목">제목 3</option>
              <option value="> 인용문">인용문</option>
            </select>
            <span className="tool-sep" />
            <button title="굵게" onClick={() => formatSelection("**")}>
              <Bold />
            </button>
            <button title="기울임" onClick={() => formatSelection("*")}>
              <Italic />
            </button>
            <button title="밑줄" onClick={() => formatSelection("<u>", "</u>")}>
              <Underline />
            </button>
            <button title="취소선" onClick={() => formatSelection("~~")}>
              <Strikethrough />
            </button>
            <span className="tool-sep" />
            <label className="color-tool" title="글자색">
              <Palette />
              <input
                type="color"
                defaultValue="#147d72"
                onChange={(e) =>
                  formatSelection(
                    `<span style=\"color:${e.target.value}\">`,
                    "</span>",
                  )
                }
              />
            </label>
            <label className="color-tool highlight" title="배경색">
              <Highlighter />
              <input
                type="color"
                defaultValue="#fff2a8"
                onChange={(e) =>
                  formatSelection(
                    `<mark style=\"background:${e.target.value}\">`,
                    "</mark>",
                  )
                }
              />
            </label>
            <select
              aria-label="글자 크기"
              defaultValue="16"
              onChange={(e) =>
                formatSelection(
                  `<span style=\"font-size:${e.target.value}px\">`,
                  "</span>",
                )
              }
            >
              <option value="12">12</option>
              <option value="14">14</option>
              <option value="16">16</option>
              <option value="18">18</option>
              <option value="24">24</option>
              <option value="32">32</option>
            </select>
            <span className="tool-sep" />
            <button
              title="왼쪽 정렬"
              onClick={() =>
                formatSelection('<div style="text-align:left">', "</div>")
              }
            >
              <AlignLeft />
            </button>
            <button
              title="가운데 정렬"
              onClick={() =>
                formatSelection('<div style="text-align:center">', "</div>")
              }
            >
              <AlignCenter />
            </button>
            <button
              title="오른쪽 정렬"
              onClick={() =>
                formatSelection('<div style="text-align:right">', "</div>")
              }
            >
              <AlignRight />
            </button>
            <span className="tool-sep" />
            <button
              title="링크"
              onClick={() => formatSelection("[", "](https://)")}
            >
              <Link />
            </button>
            <button
              title="표"
              onClick={() =>
                insertBlock(
                  "| 항목 | 내용 | 상태 |\n| --- | --- | --- |\n|  |  |  |",
                )
              }
            >
              <Table2 />
            </button>
            <button
              title="코드"
              onClick={() => insertBlock("```javascript\n// code\n```")}
            >
              <Code2 />
            </button>
          </div>
        )}
        <RichDocumentEditor
          noteId={note.id}
          content={note.content}
          mode={mode}
          preferredProvider={agents.defaultProvider}
          agentCommands={{
            codex: agents.codex.command,
            claude: agents.claude.command,
          }}
          onChange={(html) => updateNote({ content: html })}
        />
        <div className={`editor-shell legacy-editor mode-${mode}`}>
          {mode !== "preview" && (
            <section className="source-pane">
              <div className="pane-label">
                <span>
                  <Pencil size={13} /> DOCUMENT
                </span>
                <span className="slash-hint">
                  <kbd>/</kbd> 블록 삽입
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(note.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div className="source-editor">
                <textarea
                  ref={textarea}
                  value={note.content}
                  onChange={(e) => {
                    updateNote({ content: e.target.value });
                    trackSlash(e.target.value, e.target.selectionStart);
                  }}
                  onClick={(e) =>
                    trackSlash(
                      e.currentTarget.value,
                      e.currentTarget.selectionStart,
                    )
                  }
                  onKeyDown={onEditorKeyDown}
                  onPaste={onPaste}
                  spellCheck="false"
                  placeholder="내용을 입력하거나 / 를 눌러 블록을 추가하세요"
                />
                {slash && (
                  <div className="slash-menu" style={{ top: slash.top }}>
                    <div className="slash-menu-head">
                      <span>블록 추가</span>
                      <small>
                        {slash.query
                          ? `“${slash.query}” 검색`
                          : "입력해서 검색"}
                      </small>
                    </div>
                    <div className="slash-list">
                      {slashResults.length ? (
                        slashResults.map((c, i) => {
                          const Icon = c.icon;
                          return (
                            <button
                              key={c.id}
                              className={i === slashIndex ? "active" : ""}
                              onMouseDown={(e) => {
                                e.preventDefault();
                                chooseSlash(c);
                              }}
                              onMouseEnter={() => setSlashIndex(i)}
                            >
                              <span className="slash-icon">
                                <Icon size={17} />
                              </span>
                              <span>
                                <b>{c.label}</b>
                                <small>{c.description}</small>
                              </span>
                              <kbd>/{c.aliases[0]}</kbd>
                            </button>
                          );
                        })
                      ) : (
                        <div className="slash-empty">
                          일치하는 블록이 없습니다
                        </div>
                      )}
                    </div>
                    <div className="slash-footer">
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
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
          {mode !== "edit" && (
            <section className="preview-pane">
              <div className="pane-label">
                <span>
                  <Eye size={13} /> PREVIEW
                </span>
              </div>
              <Preview content={note.content} />
            </section>
          )}
        </div>
        <footer className="statusbar">
          <div>
            <span className="smart">
              <Command size={13} /> SMART PASTE
            </span>
            <span>코드 · 표 · JSON · 이미지 · Mermaid 자동 감지</span>
          </div>
          <div>
            <span>{note.content.length}자</span>
            <span>Markdown</span>
            <span>UTF-8</span>
            <span>
              Ln{" "}
              {
                note.content
                  .slice(0, textarea.current?.selectionStart || 0)
                  .split("\n").length
              }
            </span>
          </div>
        </footer>
      </main>
      {toast && (
        <div className="toast">
          {toast.icon === "code" ? (
            <Code2 />
          ) : toast.icon === "table" ? (
            <Table2 />
          ) : toast.icon === "image" ? (
            <ImageIcon />
          ) : (
            <Workflow />
          )}
          <span>
            <b>{toast.message}</b>
            <small>실행 취소는 Ctrl+Z</small>
          </span>
          <button onClick={() => setToast(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {projectDialog && (
        <div
          className="modal-backdrop project-dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setProjectDialog(null);
          }}
        >
          <section
            className={`project-dialog ${projectDialog.type === "delete" ? "delete" : ""}`}
          >
            <header>
              <span className="project-dialog-icon">
                {projectDialog.type === "delete" ? <Trash2 /> : <Folder />}
              </span>
              <span>
                <h3>
                  {projectDialog.type === "create"
                    ? "새 프로젝트"
                    : projectDialog.type === "rename"
                      ? "프로젝트 이름 변경"
                      : "프로젝트 삭제"}
                </h3>
                <p>
                  {projectDialog.type === "delete"
                    ? "이 작업은 되돌릴 수 없습니다."
                    : "프로젝트는 노트와 자료를 묶는 작업 공간입니다."}
                </p>
              </span>
              <button
                className="icon-btn"
                onClick={() => setProjectDialog(null)}
              >
                <X />
              </button>
            </header>
            {projectDialog.type === "delete" ? (
              <div className="delete-project-copy">
                <p>
                  <b>{projectDialog.name}</b> 프로젝트와 포함된 노트{" "}
                  <strong>
                    {
                      data.notes.filter((n) => n.projectId === projectDialog.id)
                        .length
                    }
                    개
                  </strong>
                  를 모두 삭제합니다.
                </p>
                <div>
                  <Trash2 />
                  <span>프로젝트의 노트가 함께 영구 삭제됩니다.</span>
                </div>
              </div>
            ) : (
              <div className="project-name-field">
                <label>프로젝트 이름</label>
                <input
                  autoFocus
                  value={projectDialog.name}
                  onChange={(e) =>
                    setProjectDialog({ ...projectDialog, name: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveProject();
                  }}
                  placeholder="프로젝트 이름을 입력하세요"
                />
                <small>{projectDialog.name.length}/40</small>
              </div>
            )}
            <footer>
              <button
                className="secondary"
                onClick={() => setProjectDialog(null)}
              >
                취소
              </button>
              <button
                className={
                  projectDialog.type === "delete" ? "danger-primary" : "primary"
                }
                disabled={
                  projectDialog.type !== "delete" && !projectDialog.name.trim()
                }
                onClick={
                  projectDialog.type === "delete" ? deleteProject : saveProject
                }
              >
                {projectDialog.type === "delete"
                  ? "모두 삭제"
                  : projectDialog.type === "create"
                    ? "프로젝트 만들기"
                    : "이름 저장"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {tableOpen && (
        <TableDesigner
          onCancel={() => setTableOpen(false)}
          onInsert={insertVisualTable}
        />
      )}
      {settingsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false);
          }}
        >
          <section className="settings-modal">
            <header>
              <div>
                <span className="settings-mark">
                  <SlidersHorizontal />
                </span>
                <span>
                  <h2>설정</h2>
                  <p>KsNote를 작업 방식에 맞게 조정합니다</p>
                </span>
              </div>
              <button
                className="icon-btn"
                onClick={() => setSettingsOpen(false)}
                aria-label="설정 닫기"
              >
                <X />
              </button>
            </header>
            <div className="settings-body">
              <nav>
                <button
                  className={settingsTab === "general" ? "active" : ""}
                  onClick={() => setSettingsTab("general")}
                >
                  <Settings />
                  일반
                </button>
                <button
                  className={settingsTab === "editor" ? "active" : ""}
                  onClick={() => setSettingsTab("editor")}
                >
                  <Pencil />
                  편집기
                </button>
                <button
                  className={settingsTab === "agent" ? "active" : ""}
                  onClick={() => setSettingsTab("agent")}
                >
                  <Bot />
                  AI Agent
                </button>
                <button
                  className={settingsTab === "mcp" ? "active" : ""}
                  onClick={() => setSettingsTab("mcp")}
                >
                  <Plug />
                  MCP 연결 <em>{mcpServers.filter((s) => s.enabled).length}</em>
                </button>
                <button
                  className={settingsTab === "data" ? "active" : ""}
                  onClick={() => setSettingsTab("data")}
                >
                  <Database />
                  데이터
                </button>
                <button
                  className={settingsTab === "security" ? "active" : ""}
                  onClick={() => setSettingsTab("security")}
                >
                  <Shield />
                  보안
                </button>
              </nav>
              <div className="settings-content">
                {settingsTab === "general" && (
                  <>
                    <div className="setting-title">
                      <h3>일반</h3>
                      <p>앱의 모양과 기본 동작을 선택합니다.</p>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>화면 테마</b>
                        <small>작업 공간에 사용할 색상 모드</small>
                      </span>
                      <select
                        value={prefs.theme}
                        onChange={(e) =>
                          setPrefs({ ...prefs, theme: e.target.value })
                        }
                      >
                        <option value="light">밝게</option>
                        <option value="system">시스템 설정</option>
                        <option value="dark">어둡게</option>
                      </select>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>시작 화면</b>
                        <small>앱을 열 때 최근 노트로 이동</small>
                      </span>
                      <label className="switch">
                        <input type="checkbox" defaultChecked />
                        <i />
                      </label>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>언어</b>
                        <small>메뉴와 안내에 사용할 언어</small>
                      </span>
                      <select>
                        <option>한국어</option>
                        <option>English</option>
                      </select>
                    </div>
                  </>
                )}
                {settingsTab === "editor" && (
                  <>
                    <div className="setting-title">
                      <h3>편집기</h3>
                      <p>글꼴과 입력 동작을 설정합니다.</p>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>기본 글자 크기</b>
                        <small>문서 편집 영역의 글자 크기</small>
                      </span>
                      <input
                        className="number-input"
                        type="number"
                        min="11"
                        max="24"
                        value={prefs.fontSize}
                        onChange={(e) =>
                          setPrefs({
                            ...prefs,
                            fontSize: Number(e.target.value),
                          })
                        }
                      />
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>편집 글꼴</b>
                        <small>문서 작성에 사용할 글꼴</small>
                      </span>
                      <select
                        value={prefs.fontFamily}
                        onChange={(e) =>
                          setPrefs({ ...prefs, fontFamily: e.target.value })
                        }
                      >
                        <option value="mono">DM Mono</option>
                        <option value="sans">Noto Sans KR</option>
                        <option value="system">시스템 글꼴</option>
                      </select>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>맞춤법 검사</b>
                        <small>입력 중 잘못된 단어 표시</small>
                      </span>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={prefs.spellcheck}
                          onChange={(e) =>
                            setPrefs({ ...prefs, spellcheck: e.target.checked })
                          }
                        />
                        <i />
                      </label>
                    </div>
                  </>
                )}
                {settingsTab === "agent" && (
                  <>
                    <div className="setting-title">
                      <h3>AI Agent</h3>
                      <p>
                        구독 계정으로 로그인된 로컬 CLI를 KsNote 편집기에
                        연결합니다.
                      </p>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>기본 Agent</b>
                        <small>AI 푸터에서 먼저 선택되는 실행 도구</small>
                      </span>
                      <select
                        value={agents.defaultProvider}
                        onChange={(e) =>
                          setAgents({
                            ...agents,
                            defaultProvider: e.target.value,
                          })
                        }
                      >
                        <option value="codex">Codex</option>
                        <option value="claude">Claude</option>
                      </select>
                    </div>
                    {[
                      ["codex", "Codex CLI"],
                      ["claude", "Claude Code"],
                    ].map(([id, label]) => (
                      <div className="agent-card" key={id}>
                        <span className="agent-icon">
                          <Terminal />
                        </span>
                        <span className="agent-info">
                          <b>{label}</b>
                          <small>
                            공식 CLI의 기존 로그인 세션을 사용합니다.
                          </small>
                          <label>
                            실행 명령
                            <input
                              value={agents[id].command}
                              onChange={(e) =>
                                setAgents({
                                  ...agents,
                                  [id]: {
                                    ...agents[id],
                                    command: e.target.value,
                                  },
                                })
                              }
                            />
                          </label>
                        </span>
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={agents[id].enabled}
                            onChange={(e) =>
                              setAgents({
                                ...agents,
                                [id]: {
                                  ...agents[id],
                                  enabled: e.target.checked,
                                },
                              })
                            }
                          />
                          <i />
                        </label>
                      </div>
                    ))}
                    <div className="agent-note">
                      <Shield />
                      <span>
                        <b>계정 정보는 KsNote에 저장하지 않습니다.</b>
                        <small>
                          인증과 사용량 관리는 각 공식 CLI가 담당합니다.
                        </small>
                      </span>
                    </div>
                  </>
                )}
                {settingsTab === "mcp" && (
                  <>
                    <div className="setting-title with-action">
                      <span>
                        <h3>MCP 연결</h3>
                        <p>외부 도구와 데이터 소스를 연결합니다.</p>
                      </span>
                      <button onClick={addMcpServer}>
                        <Plus /> 서버 추가
                      </button>
                    </div>
                    <div className="mcp-callout">
                      <Plug />
                      <span>
                        <b>Model Context Protocol</b>
                        <small>
                          MCP 서버는 로컬에서 실행되며 실행 전 사용자의 승인을
                          받습니다.
                        </small>
                      </span>
                      <ExternalLink />
                    </div>
                    <div className="mcp-list">
                      {mcpServers.map((server) => (
                        <div className="mcp-card" key={server.id}>
                          <span className="server-icon">
                            <Server />
                          </span>
                          <span className="server-info">
                            <input
                              value={server.name}
                              onChange={(e) =>
                                setMcpServers((s) =>
                                  s.map((x) =>
                                    x.id === server.id
                                      ? { ...x, name: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <label>
                              명령
                              <input
                                value={server.command}
                                onChange={(e) =>
                                  setMcpServers((s) =>
                                    s.map((x) =>
                                      x.id === server.id
                                        ? { ...x, command: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                            <label>
                              인자
                              <input
                                value={server.args || ""}
                                placeholder="예: @modelcontextprotocol/server-filesystem C:\\Notes"
                                onChange={(e) =>
                                  setMcpServers((s) =>
                                    s.map((x) =>
                                      x.id === server.id
                                        ? { ...x, args: e.target.value }
                                        : x,
                                    ),
                                  )
                                }
                              />
                            </label>
                          </span>
                          <span
                            className={`server-status ${server.enabled ? "ready" : ""}`}
                          >
                            <i />
                            {server.enabled ? "활성" : "꺼짐"}
                          </span>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={server.enabled}
                              onChange={(e) =>
                                setMcpServers((s) =>
                                  s.map((x) =>
                                    x.id === server.id
                                      ? { ...x, enabled: e.target.checked }
                                      : x,
                                  ),
                                )
                              }
                            />
                            <i />
                          </label>
                          <button
                            className="delete-server"
                            onClick={() =>
                              setMcpServers((s) =>
                                s.filter((x) => x.id !== server.id),
                              )
                            }
                          >
                            <Trash2 />
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {settingsTab === "data" && (
                  <>
                    <div className="setting-title">
                      <h3>데이터</h3>
                      <p>노트와 첨부파일의 저장 위치를 관리합니다.</p>
                    </div>
                    <div className="storage-card">
                      <Database />
                      <span>
                        <b>로컬 저장소</b>
                        <small>C:\Users\TOVIS\Documents\KsNote</small>
                      </span>
                      <button>폴더 열기</button>
                    </div>
                  </>
                )}
                {settingsTab === "security" && (
                  <>
                    <div className="setting-title">
                      <h3>보안</h3>
                      <p>자격 증명과 외부 실행 권한을 관리합니다.</p>
                    </div>
                    <div className="setting-row">
                      <span>
                        <b>MCP 실행 전 확인</b>
                        <small>
                          도구가 변경 작업을 수행하기 전에 승인 요청
                        </small>
                      </span>
                      <label className="switch">
                        <input type="checkbox" defaultChecked />
                        <i />
                      </label>
                    </div>
                  </>
                )}
              </div>
            </div>
            <footer>
              <span>설정은 이 기기에만 저장됩니다.</span>
              <button onClick={() => setSettingsOpen(false)}>완료</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
