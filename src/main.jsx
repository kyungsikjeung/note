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
  History,
  CalendarDays,
  Mail,
  Zap,
  Hash,
} from "lucide-react";
import "highlight.js/styles/github.css";
import "./styles.css";
import "./slash.css";
import "./settings.css";
import "./settings-agent.css";
import "./developer-logs.css";
import "./table.css";
import RichDocumentEditor from "./RichDocumentEditor";
import "./editor-migration.css";
import "./project-manager.css";
import "./workspace-menu.css";
import "./page-actions.css";
import "./page-management.css";
import "./shortcuts.css";
import "./themes.css";

mermaid.initialize({
  startOnLoad: false,
  theme: "neutral",
  securityLevel: "strict",
  fontFamily: "Pretendard, sans-serif",
});

const AI_MODELS = [
  { id: "", label: "Codex 기본 모델", provider: "codex" },
  { id: "sonnet", label: "Claude Sonnet", provider: "claude" },
  { id: "opus", label: "Claude Opus", provider: "claude" },
  { id: "haiku", label: "Claude Haiku", provider: "claude" },
];

const DEFAULT_AI_MODEL = AI_MODELS[0].id;
const getAiModel = (id) =>
  AI_MODELS.find((model) => model.id === id) || AI_MODELS[0];

const contentRevision = (value) => {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
};

const MANAGED_MCP_SERVERS = [
  {
    id: "ksnote",
    name: "KsNote MCP",
    description: "Codex가 현재 프로젝트, 페이지와 커서 위치에 다이어그램을 삽입",
    command: "node",
    args: "mcp/ksnote-server.mjs",
    enabled: false,
    status: "setup",
    managed: true,
    icon: "ksnote",
    category: "local",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "노트의 일정과 마감일을 캘린더 이벤트로 연결",
    command: "",
    enabled: false,
    status: "setup",
    managed: true,
    icon: "calendar",
  },
  {
    id: "gmail",
    name: "Gmail",
    description: "노트 내용을 바탕으로 메일 초안과 후속 작업 생성",
    command: "",
    enabled: false,
    status: "setup",
    managed: true,
    icon: "mail",
  },
  {
    id: "rovo",
    name: "Atlassian Rovo",
    description: "Jira와 Confluence 자료 조사 및 업무 문맥 연결",
    command: "codex",
    enabled: false,
    status: "setup",
    managed: true,
    icon: "rovo",
  },
];

const mergeManagedMcpServers = (servers = []) => [
  ...servers,
  ...MANAGED_MCP_SERVERS.filter(
    (managed) => !servers.some((server) => server.id === managed.id),
  ),
];
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
const escapeAttribute = (value) => String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "&#10;");
const markdownToRich = (markdown) => {
  const diagrams = [];
  const prepared = String(markdown || "").replace(/```(mermaid|plantuml)\s*\n([\s\S]*?)```/gi, (_, type, code) => {
    const token = `KSNOTE_DIAGRAM_${diagrams.length}_TOKEN`;
    diagrams.push(`<div data-type="${type.toLowerCase()}" data-code="${escapeAttribute(code.trim())}"></div>`);
    return token;
  });
  let html = marked.parse(prepared);
  diagrams.forEach((diagram, index) => { html = html.replace(`<p>KSNOTE_DIAGRAM_${index}_TOKEN</p>`, diagram).replace(`KSNOTE_DIAGRAM_${index}_TOKEN`, diagram); });
  return html;
};

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
  const [editorTarget, setEditorTarget] = useState(null);
  const [slash, setSlash] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [tasksOverviewOpen, setTasksOverviewOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");
  const [mcpInfo, setMcpInfo] = useState(null);
  const [mcpInstallStatus, setMcpInstallStatus] = useState(null);
  const [tableOpen, setTableOpen] = useState(false);
  const tableInsertPos = useRef(null);
  const [projectDialog, setProjectDialog] = useState(null);
  const [projectMenu, setProjectMenu] = useState(null);
  const [noteMenu, setNoteMenu] = useState(null);
  const [entityMenuPosition, setEntityMenuPosition] = useState(null);
  const [prefs, setPrefs] = useState(() => {
    try {
      return (
        JSON.parse(localStorage.getItem("mori-prefs")) || {
          theme: "light",
          fontSize: 14,
          fontFamily: "mono",
          spellcheck: false,
          plantumlJar: "",
          customSlashCommands: [],
        }
      );
    } catch {
      return {
        theme: "light",
        fontSize: 14,
        fontFamily: "mono",
        spellcheck: false,
        plantumlJar: "",
        customSlashCommands: [],
      };
    }
  });
  const [agents, setAgents] = useState(() => {
    const defaults = {
      defaultModel: DEFAULT_AI_MODEL,
      codex: { enabled: true, command: "codex" },
      claude: { enabled: false, command: "claude" },
    };
    try {
      const saved = JSON.parse(localStorage.getItem("ksnote-agents"));
      if (!saved) return defaults;
      return {
        ...defaults,
        ...saved,
        defaultModel:
          saved.defaultModel ||
          (saved.defaultProvider === "claude" ? "sonnet" : DEFAULT_AI_MODEL),
        codex: { ...defaults.codex, ...saved.codex },
        claude: { ...defaults.claude, ...saved.claude },
      };
    } catch {
      return defaults;
    }
  });
  const [mcpServers, setMcpServers] = useState(() => {
    const defaults = [
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
    ];
    try {
      return mergeManagedMcpServers(
        JSON.parse(localStorage.getItem("mori-mcp")) || defaults,
      );
    } catch {
      return mergeManagedMcpServers(defaults);
    }
  });
  const activeAutomationCount = mcpServers.filter(
    (server) => server.managed && server.category !== "local" && server.enabled,
  ).length;
  const textarea = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const storageReady = useRef(false);
  const dragItem = useRef(null);
  const [dragOverProjectId, setDragOverProjectId] = useState(null);
  const [revisions, setRevisions] = useState([]);
  const [diagnostics, setDiagnostics] = useState({});
  const [availableAiModels, setAvailableAiModels] = useState(AI_MODELS);
  const [aiDebugLogs, setAiDebugLogs] = useState(() => {
    try { return JSON.parse(localStorage.getItem("ksnote-ai-debug-logs")) || []; }
    catch { return []; }
  });
  const [editorDebugLogs, setEditorDebugLogs] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem("ksnote-editor-debug-logs")) || [])
        .slice(0, 30)
        .map(({ document, ...log }) => log);
    }
    catch { return []; }
  });
  const activeNotes = data.notes.filter((n) => !n.trashed);
  const note =
    activeNotes.find((n) => n.id === noteId) ||
    activeNotes.find((n) => n.projectId === projectId) ||
    activeNotes[0];
  const projectNotes = data.notes
    .filter((n) => !n.trashed && n.projectId === projectId)
    .sort((a, b) => (a.order ?? -a.updatedAt) - (b.order ?? -b.updatedAt));
  const notes = (() => {
    if (search.trim())
      return projectNotes
        .filter((n) => n.title.toLowerCase().includes(search.toLowerCase()))
        .map((n) => ({ ...n, depth: 0 }));
    const noteByParent = new Map();
    projectNotes.forEach((item) => {
      const parentId = projectNotes.some((parent) => parent.id === item.parentId)
        ? item.parentId
        : null;
      const children = noteByParent.get(parentId) || [];
      children.push(item);
      noteByParent.set(parentId, children);
    });
    const flattened = [];
    const visited = new Set();
    const appendBranch = (parentId, depth) => {
      (noteByParent.get(parentId) || []).forEach((item) => {
        if (visited.has(item.id)) return;
        visited.add(item.id);
        flattened.push({ ...item, depth });
        appendBranch(item.id, depth + 1);
      });
    };
    appendBranch(null, 0);
    projectNotes.forEach((item) => {
      if (!visited.has(item.id)) flattened.push({ ...item, depth: 0 });
    });
    return flattened;
  })();
  const projectTasks = useMemo(() => data.notes.filter((item) => !item.trashed && item.projectId === projectId).flatMap((item) => {
    const documentNode = new DOMParser().parseFromString(item.content || "", "text/html");
    return Array.from(documentNode.querySelectorAll('li[data-type="taskItem"], li[data-checked]')).map((task, index) => ({
      id: `${item.id}-${index}`,
      noteId: item.id,
      noteTitle: item.title,
      text: task.textContent.trim(),
      checked: task.getAttribute("data-checked") === "true",
      dueDate: task.getAttribute("data-due-date") || "",
      assignee: task.getAttribute("data-assignee") || "",
      priority: task.getAttribute("data-priority") || "normal",
    }));
  }), [data.notes, projectId]);
  useEffect(() => {
    let live = true;
    window.ksnoteStorage?.load().then((stored) => {
      if (!live) return;
      if (stored?.projects && stored?.notes) setData(stored);
      storageReady.current = true;
      if (!stored) window.ksnoteStorage?.save(data);
    }).catch(() => { storageReady.current = true; });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      localStorage.setItem("mori-data", JSON.stringify(data));
      if (storageReady.current) window.ksnoteStorage?.save(data);
      setSaved(true);
    }, 350);
    return () => clearTimeout(t);
  }, [data]);
  useEffect(() => {
    if (settingsOpen && settingsTab === "data" && note?.id) window.ksnoteStorage?.revisions(note.id).then(setRevisions).catch(() => setRevisions([]));
  }, [settingsOpen, settingsTab, note?.id, data]);
  useEffect(() => {
    localStorage.setItem("mori-prefs", JSON.stringify(prefs));
  }, [prefs]);
  useEffect(() => {
    const updateLogs = (event) => setAiDebugLogs(event.detail || []);
    window.addEventListener("ksnote-ai-debug-log", updateLogs);
    return () => window.removeEventListener("ksnote-ai-debug-log", updateLogs);
  }, []);
  useEffect(() => {
    const updateLogs = (event) => setEditorDebugLogs(event.detail || []);
    window.addEventListener("ksnote-editor-debug-log", updateLogs);
    return () => window.removeEventListener("ksnote-editor-debug-log", updateLogs);
  }, []);
  useEffect(() => {
    localStorage.setItem("ksnote-editor-debug-logs", JSON.stringify(editorDebugLogs));
  }, [editorDebugLogs]);
  useEffect(() => {
    localStorage.setItem("ksnote-agents", JSON.stringify(agents));
  }, [agents]);
  useEffect(() => {
    let live = true;
    const refreshCodex = async () => {
      try {
        const [result, accountResult] = await Promise.all([
          window.ksnoteAI?.models?.({ command: agents.codex.command }),
          window.ksnoteAI?.account?.({ command: agents.codex.command }),
        ]);
        if (live) {
          const account = accountResult?.account;
          setDiagnostics((current) => ({
            ...current,
            "agent-codex": {
              ...current["agent-codex"],
              installed: true,
              authenticated: Boolean(account),
              ok: Boolean(account),
              loading: false,
              account,
              message: account?.type === "chatgpt"
                ? `${account.email || "ChatGPT 계정"} · ${account.planType || "구독"}`
                : account?.type === "apiKey"
                  ? "API 키로 로그인됨"
                  : "ChatGPT 구독 로그인이 필요합니다.",
            },
          }));
        }
        if (!live || !result?.data?.length) return;
        const codexModels = result.data.map((model) => ({
          id: model.model || model.id,
          label: model.displayName || model.model || model.id,
          provider: "codex",
          isDefault: Boolean(model.isDefault),
          defaultReasoningEffort: model.defaultReasoningEffort,
          supportedReasoningEfforts: model.supportedReasoningEfforts || [],
        }));
        const claudeModels = AI_MODELS.filter(
          (model) => model.provider === "claude",
        );
        setAvailableAiModels([...codexModels, ...claudeModels]);
        setAgents((current) => {
          const selectedExists = codexModels.some(
            (model) => model.id === current.defaultModel,
          );
          if (
            selectedExists ||
            claudeModels.some((model) => model.id === current.defaultModel)
          ) return current;
          return {
            ...current,
            defaultModel:
              codexModels.find((model) => model.isDefault)?.id ||
              codexModels[0].id,
          };
        });
      } catch {
        // 설정 화면의 연결 진단에서 구체적인 오류와 로그인 방법을 표시한다.
      }
    };
    refreshCodex();
    const removeAccountListener = window.ksnoteAI?.onAccount?.(refreshCodex);
    return () => {
      live = false;
      removeAccountListener?.();
    };
  }, [agents.codex.command]);
  useEffect(() => {
    localStorage.setItem("mori-mcp", JSON.stringify(mcpServers));
  }, [mcpServers]);
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "mcp") return;
    window.ksnoteMcp?.info?.().then(setMcpInfo).catch(() => setMcpInfo(null));
  }, [settingsOpen, settingsTab]);
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "agent") return;
    ["codex", "claude"].forEach(async (provider) => {
      const key = `agent-${provider}`;
      setDiagnostics((current) => ({
        ...current,
        [key]: { loading: true, message: "설치 및 로그인 확인 중…" },
      }));
      try {
        const result = await window.ksnoteAI?.diagnose?.({
          provider,
          command: agents[provider].command,
        });
        setDiagnostics((current) => ({
          ...current,
          [key]: {
            ...result,
            ok: Boolean(result?.installed) && result?.authenticated !== false,
            loading: false,
          },
        }));
      } catch (error) {
        setDiagnostics((current) => ({
          ...current,
          [key]: { ok: false, loading: false, message: error.message },
        }));
      }
    });
  }, [settingsOpen, settingsTab]);
  useEffect(() => {
    if (!settingsOpen || !["automation", "mcp"].includes(settingsTab)) return;
    const diagnoseRovo = async () => {
      const key = "mcp-rovo";
      setDiagnostics((current) => ({
        ...current,
        [key]: { loading: true, message: "Rovo 연결 확인 중…" },
      }));
      try {
        const result = await window.ksnoteAI?.diagnoseRovo?.({
          command: agents.codex.command,
        });
        setDiagnostics((current) => ({
          ...current,
          [key]: { ...result, loading: false },
        }));
      } catch (error) {
        setDiagnostics((current) => ({
          ...current,
          [key]: { ok: false, loading: false, message: error.message },
        }));
      }
    };
    diagnoseRovo();
  }, [settingsOpen, settingsTab]);
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
  useEffect(() => {
    if (!projectMenu && !noteMenu) return;
    const close = (event) => {
      if (event.target.closest?.(".entity-more, .entity-popover")) return;
      setProjectMenu(null);
      setNoteMenu(null);
      setEntityMenuPosition(null);
    };
    const escape = (event) => {
      if (event.key !== "Escape") return;
      setProjectMenu(null);
      setNoteMenu(null);
      setEntityMenuPosition(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [projectMenu, noteMenu]);
  const toggleEntityMenu = (type, id, event) => {
    event.stopPropagation();
    const isOpen = type === "project" ? projectMenu === id : noteMenu === id;
    if (isOpen) {
      setProjectMenu(null);
      setNoteMenu(null);
      setEntityMenuPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setEntityMenuPosition({
      top: Math.min(rect.bottom + 4, window.innerHeight - 116),
      left: Math.max(8, Math.min(rect.right - 166, window.innerWidth - 174)),
    });
    setProjectMenu(type === "project" ? id : null);
    setNoteMenu(type === "note" ? id : null);
  };
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
  const addNote = (targetProjectId = projectId, parentId = null) => {
    if (!targetProjectId) return;
    const n = {
      id: uid("n"),
      projectId: targetProjectId,
      parentId,
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
  const trashNote = (id) => {
    const target = data.notes.find((n) => n.id === id);
    if (!target) return;
    const next = data.notes.find(
      (n) => n.projectId === target.projectId && n.id !== id && !n.trashed,
    );
    if (next) {
      setData((d) => ({
        ...d,
        notes: d.notes.map((n) =>
          n.id === id ? { ...n, trashed: true, trashedAt: Date.now() } : n,
        ),
      }));
      if (noteId === id) setNoteId(next.id);
    } else {
      const replacement = {
        id: uid("n"),
        projectId: target.projectId,
        title: "제목 없는 노트",
        content: "<h1>제목 없는 노트</h1><p></p>",
        updatedAt: Date.now(),
      };
      setData((d) => ({
        ...d,
        notes: [
          replacement,
          ...d.notes.map((n) =>
            n.id === id ? { ...n, trashed: true, trashedAt: Date.now() } : n,
          ),
        ],
      }));
      setNoteId(replacement.id);
    }
    setNoteMenu(null);
  };
  const restoreNote = (id) =>
    setData((d) => ({
      ...d,
      notes: d.notes.map((n) =>
        n.id === id
          ? { ...n, trashed: false, trashedAt: null, updatedAt: Date.now() }
          : n,
      ),
    }));
  const deleteNotePermanently = (id) =>
    setData((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
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
  const restoreRevision = async (id) => {
    const revision = await window.ksnoteStorage?.revision(id);
    if (revision?.content) updateNote({ content: revision.content });
  };
  const reorderProjects = (sourceId, targetId) => {
    if (!sourceId || sourceId === targetId) return;
    setData((current) => {
      const projects = [...current.projects];
      const from = projects.findIndex((item) => item.id === sourceId);
      const to = projects.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return current;
      projects.splice(to, 0, projects.splice(from, 1)[0]);
      return { ...current, projects };
    });
  };
  const reorderNotes = (sourceId, targetId) => {
    if (!sourceId || sourceId === targetId) return;
    const ordered = [...notes];
    const from = ordered.findIndex((item) => item.id === sourceId);
    const to = ordered.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    const orderById = new Map(ordered.map((item, index) => [item.id, index]));
    setData((current) => ({ ...current, notes: current.notes.map((item) => orderById.has(item.id) ? { ...item, order: orderById.get(item.id) } : item) }));
  };
  const moveNoteToProject = (sourceId, targetProjectId) => {
    if (!sourceId || !targetProjectId) return;
    const source = data.notes.find((item) => item.id === sourceId);
    if (!source || source.projectId === targetProjectId) return;
    const movedIds = new Set([sourceId]);
    let foundChild = true;
    while (foundChild) {
      foundChild = false;
      data.notes.forEach((item) => {
        if (item.parentId && movedIds.has(item.parentId) && !movedIds.has(item.id)) {
          movedIds.add(item.id);
          foundChild = true;
        }
      });
    }
    const targetOrder = data.notes
      .filter((item) => item.projectId === targetProjectId && !item.trashed)
      .reduce((maximum, item) => Math.max(maximum, item.order ?? -1), -1) + 1;
    const movedAt = Date.now();
    setData((current) => ({
      ...current,
      notes: current.notes.map((item) => {
        if (!movedIds.has(item.id)) return item;
        return {
          ...item,
          projectId: targetProjectId,
          parentId: item.id === sourceId ? null : item.parentId,
          order: item.id === sourceId ? targetOrder : item.order,
          updatedAt: movedAt,
        };
      }),
    }));
    setProjectId(targetProjectId);
    setNoteId(sourceId);
    showToast(`페이지를 ${data.projects.find((item) => item.id === targetProjectId)?.name || "프로젝트"}로 이동했습니다`, "note");
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
  const pageRefFor = (targetNote = note) => `ksnote://page/${targetNote.id}`;
  const selectionRefFor = (target = editorTarget, targetNote = note) => {
    const from = Number.isFinite(target?.from) ? target.from : 0;
    const to = Number.isFinite(target?.to) ? target.to : from;
    return `${pageRefFor(targetNote)}?from=${from}&to=${to}`;
  };
  const handleEditorTargetChange = (target) => {
    setEditorTarget(target);
    if (!note?.id || target?.noteId !== note.id) return;
    const from = Number.isFinite(target.from) ? target.from : 0;
    const to = Number.isFinite(target.to) ? target.to : from;
    const enriched = {
      ...target,
      from,
      to,
      pageId: note.id,
      noteId: note.id,
      pageTitle: note.title,
      projectId: note.projectId,
      projectName: data.projects.find((project) => project.id === note.projectId)?.name || note.projectId,
      targetRef: `${pageRefFor(note)}?from=${from}&to=${to}`,
      operation: from === to ? "insert" : "replace-selection",
      revision: contentRevision(note.content),
    };
    window.ksnoteMcp?.saveTarget?.(enriched).catch(() => {});
  };
  const copyText = async (value, message = "복사했습니다") => {
    await navigator.clipboard.writeText(value);
    showToast(message, "code");
  };
  const copyPageReference = (targetNote = note) =>
    copyText(pageRefFor(targetNote), "페이지 ID를 복사했습니다");
  const copyCodexTarget = (targetNote = note, target = editorTarget) => {
    const ref = targetNote.id === note.id ? selectionRefFor(target, targetNote) : pageRefFor(targetNote);
    const mode = targetNote.id === note.id && target?.from !== target?.to ? "replace-selection" : "append";
    return copyText(
      [
        `KsNote target: ${ref}`,
        `Project: ${data.projects.find((p) => p.id === targetNote.projectId)?.name || targetNote.projectId}`,
        `Page: ${targetNote.title}`,
        `Operation: ${mode}`,
        "Use KsNote MCP to insert the generated content into this target.",
      ].join("\n"),
      "Codex 타깃을 복사했습니다",
    );
  };
  const registerKsNoteMcpForCodex = async () => {
    setMcpInstallStatus({ loading: true, message: "Codex MCP 등록 중..." });
    try {
      const result = await window.ksnoteMcp?.registerCodex?.({
        command: agents.codex.command || "codex",
      });
      setMcpInstallStatus({
        ok: Boolean(result?.ok),
        message: result?.message || "성공했습니다. 새 Codex 세션에서 KsNote MCP를 사용할 수 있습니다.",
        detail: result?.detail || "",
      });
      window.ksnoteMcp?.info?.().then(setMcpInfo).catch(() => {});
    } catch (error) {
      setMcpInstallStatus({
        ok: false,
        message: error.message || "Codex MCP 등록에 실패했습니다.",
      });
    }
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
  const testCommand = async (id, commandLine, mode) => {
    setDiagnostics((current) => ({ ...current, [id]: { loading: true, message: "확인 중…" } }));
    try {
      const result = await window.ksnoteDiagnostics?.test({ commandLine, mode });
      setDiagnostics((current) => ({ ...current, [id]: result || { ok: false, message: "데스크톱 앱에서 확인해 주세요." } }));
    } catch (error) {
      setDiagnostics((current) => ({ ...current, [id]: { ok: false, message: error.message } }));
    }
  };
  const importMarkdownFile = async () => {
    const imported = await window.mori?.importMarkdown();
    if (!imported) return;
    updateNote({ title: imported.name || note.title, content: markdownToRich(imported.markdown) });
    setMoreOpen(false);
  };
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
    <div className={`app theme-${prefs.theme}`}>
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
                className={`project-row ${p.id === projectId ? "active" : ""} ${projectMenu === p.id ? "menu-open" : ""} ${dragOverProjectId === p.id ? "note-drop-target" : ""}`}
                key={p.id}
                draggable
                onDragStart={(event) => {
                  dragItem.current = { type: "project", id: p.id };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-ksnote-project", p.id);
                }}
                onDragEnd={() => { dragItem.current = null; setDragOverProjectId(null); }}
                onDragEnter={() => {
                  if (dragItem.current?.type === "note") setDragOverProjectId(p.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget)) setDragOverProjectId((current) => current === p.id ? null : current);
                }}
                onDragOver={(event) => {
                  if (!["project", "note"].includes(dragItem.current?.type)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragItem.current?.type === "project") reorderProjects(dragItem.current.id, p.id);
                  if (dragItem.current?.type === "note") moveNoteToProject(dragItem.current.id, p.id);
                  dragItem.current = null;
                  setDragOverProjectId(null);
                }}
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
                  className="project-more entity-more"
                  aria-label={`${p.name} 프로젝트 메뉴`}
                  aria-haspopup="menu"
                  aria-expanded={projectMenu === p.id}
                  onClick={(event) => toggleEntityMenu("project", p.id, event)}
                >
                  <MoreHorizontal size={14} />
                </button>
                {projectMenu === p.id && (
                  <div className="project-popover entity-popover" role="menu" style={entityMenuPosition}>
                    <button
                      role="menuitem"
                      onClick={() => {
                        addNote(p.id);
                        setProjectMenu(null);
                      }}
                    >
                      <Plus /> 페이지 추가
                    </button>
                    <button
                      role="menuitem"
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
                      role="menuitem"
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
              <button onClick={() => setTasksOverviewOpen(true)} title="프로젝트 전체 할 일"><ListChecks size={13} /></button>
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
              <div
                className={`page-row ${n.id === noteId ? "active" : ""} ${noteMenu === n.id ? "menu-open" : ""} ${n.parentId ? "child-page" : ""}`}
                style={{ "--page-depth": n.depth || 0 }}
                key={n.id}
                draggable
                onDragStart={(event) => {
                  dragItem.current = { type: "note", id: n.id };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-ksnote-note", n.id);
                }}
                onDragEnd={() => { dragItem.current = null; setDragOverProjectId(null); }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => { if (dragItem.current?.type === "note") reorderNotes(dragItem.current.id, n.id); dragItem.current = null; }}
              >
                <button className="page-main" onClick={() => setNoteId(n.id)}>
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
                <button
                  className="page-more entity-more"
                  aria-label={`${n.title} 페이지 메뉴`}
                  aria-haspopup="menu"
                  aria-expanded={noteMenu === n.id}
                  onClick={(event) => toggleEntityMenu("note", n.id, event)}
                >
                  <MoreHorizontal size={14} />
                </button>
                {noteMenu === n.id && (
                  <div className="page-popover entity-popover" role="menu" style={entityMenuPosition}>
                    <button
                      role="menuitem"
                      onClick={() => {
                        addNote(n.projectId, n.id);
                        setNoteMenu(null);
                      }}
                    >
                      <Plus /> 하위 페이지 추가
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setNoteId(n.id);
                        setNoteMenu(null);
                        requestAnimationFrame(() =>
                          document.querySelector(".title-area input")?.focus(),
                        );
                      }}
                    >
                      <Pencil /> 이름 변경
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        copyPageReference(n);
                        setNoteMenu(null);
                      }}
                    >
                      <Hash /> 페이지 ID 복사
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        copyCodexTarget(n, n.id === note.id ? editorTarget : null);
                        setNoteMenu(null);
                      }}
                    >
                      <Copy /> Codex 타깃 복사
                    </button>
                    <button role="menuitem" className="danger" onClick={() => trashNote(n.id)}>
                      <Trash2 /> 휴지통으로 이동
                    </button>
                  </div>
                )}
              </div>
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
                        {getAiModel(agents.defaultModel).label} 기본 사용
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
                  <button onClick={() => openSettings("automation")}>
                    <Zap />
                    <span>
                      <b>자동화</b>
                      <small>
                        {activeAutomationCount}개 연결 활성
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
            <button
              className="page-ref-chip"
              title={`페이지 ID 복사: ${note.id}`}
              onClick={() => copyPageReference(note)}
            >
              <Hash size={12} /> {note.id.split("-").slice(0, 2).join("-")}
            </button>
            <button
              className="page-ref-chip"
              title="현재 커서 또는 선택 영역을 Codex 타깃으로 복사"
              onClick={() => copyCodexTarget(note, editorTarget)}
            >
              <Copy size={12} /> 타깃
            </button>
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
                        {getAiModel(agents.defaultModel).label} 기본 사용
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
                  <button
                    onClick={() => {
                      setSettingsOpen(true);
                      setSettingsTab("automation");
                      setMoreOpen(false);
                    }}
                  >
                    <Zap />
                    <span>
                      <b>자동화</b>
                      <small>캘린더, 메일 및 Rovo 연결</small>
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
                  <button onClick={importMarkdownFile}>
                    <FileText />
                    <span><b>Markdown 가져오기</b><small>현재 페이지에서 다시 편집</small></span>
                  </button>
                  <button
                    onClick={() =>
                      window.mori?.exportNote({
                        title: note.title,
                        content: note.content,
                        format: "html",
                      })
                    }
                  >
                    <Download />
                    <span>
                      <b>HTML로 내보내기</b>
                      <small>브라우저용 문서</small>
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      window.mori?.exportNote({
                        title: note.title,
                        content: note.content,
                        format: "pdf",
                      })
                    }
                  >
                    <Download />
                    <span>
                      <b>PDF로 내보내기</b>
                      <small>A4 문서</small>
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      window.mori?.exportNote({
                        title: note.title,
                        content: note.content,
                        format: "docx",
                      })
                    }
                  >
                    <Download />
                    <span>
                      <b>Word로 내보내기</b>
                      <small>DOCX 문서</small>
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      setShortcutsOpen(true);
                      setMoreOpen(false);
                    }}
                  >
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
          projectId={projectId}
          content={note.content}
          mode={mode}
          preferredModel={agents.defaultModel}
          availableModels={availableAiModels}
          agentCommands={{
            codex: agents.codex.command,
            claude: agents.claude.command,
          }}
          preferences={prefs}
          onChange={(html) => updateNote({ content: html })}
          onCreateChildPage={() => addNote(note.projectId, note.id)}
          onTargetChange={handleEditorTargetChange}
          onExternalOperation={(event) =>
            showToast(
              event.message,
              event.status === "completed" ? "diagram" : "warning",
            )
          }
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
      {tasksOverviewOpen && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setTasksOverviewOpen(false); }}>
          <section className="tasks-overview-modal">
            <header><span><ListChecks /><span><h2>프로젝트 할 일</h2><p>{data.projects.find((item) => item.id === projectId)?.name} · {projectTasks.filter((item) => !item.checked).length}개 남음</p></span></span><button onClick={() => setTasksOverviewOpen(false)}><X /></button></header>
            <div className="tasks-overview-list">
              {projectTasks.length ? projectTasks.map((task) => (
                <button key={task.id} className={task.checked ? "done" : ""} onClick={() => { setNoteId(task.noteId); setTasksOverviewOpen(false); }}>
                  <Check />
                  <span><b>{task.text || "내용 없는 할 일"}</b><small>{task.noteTitle}{task.assignee ? ` · ${task.assignee}` : ""}{task.dueDate ? ` · ${task.dueDate}` : ""}</small></span>
                  <em className={`priority-${task.priority}`}>{task.priority === "high" ? "높음" : task.priority === "low" ? "낮음" : "보통"}</em>
                </button>
              )) : <p>이 프로젝트에는 아직 할 일이 없습니다.</p>}
            </div>
          </section>
        </div>
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
                  className={settingsTab === "automation" ? "active" : ""}
                  onClick={() => setSettingsTab("automation")}
                >
                  <Zap />
                  자동화
                  <em>{activeAutomationCount}</em>
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
                <button className={settingsTab === "developer" ? "active" : ""} onClick={() => setSettingsTab("developer")}>
                  <Terminal />
                  개발자
                  {prefs.developerMode && <em>{aiDebugLogs.length}</em>}
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
                        <b>PlantUML JAR</b>
                        <small>로컬 Java 렌더링에 사용할 plantuml.jar 절대 경로</small>
                      </span>
                      <input
                        className="path-input"
                        value={prefs.plantumlJar || ""}
                        placeholder="C:\\Tools\\plantuml.jar"
                        onChange={(event) => setPrefs({ ...prefs, plantumlJar: event.target.value })}
                      />
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
                    <div className="custom-command-settings">
                      <div>
                        <span>
                          <b>사용자 Slash Command</b>
                          <small>자주 쓰는 문서 템플릿을 `/명령`으로 삽입합니다.</small>
                        </span>
                        <button onClick={() => setPrefs({ ...prefs, customSlashCommands: [...(prefs.customSlashCommands || []), { id: uid("slash"), command: "template", label: "새 템플릿", template: "## 새 섹션\n\n내용" }] })}><Plus /> 추가</button>
                      </div>
                      {(prefs.customSlashCommands || []).map((command, index) => (
                        <div className="custom-command-row" key={command.id}>
                          <input value={command.command} placeholder="명령" onChange={(e) => setPrefs({ ...prefs, customSlashCommands: prefs.customSlashCommands.map((item, itemIndex) => itemIndex === index ? { ...item, command: e.target.value.replace(/^\//, "").replace(/\s/g, "") } : item) })} />
                          <input value={command.label} placeholder="표시 이름" onChange={(e) => setPrefs({ ...prefs, customSlashCommands: prefs.customSlashCommands.map((item, itemIndex) => itemIndex === index ? { ...item, label: e.target.value } : item) })} />
                          <textarea value={command.template} placeholder="Markdown 템플릿" onChange={(e) => setPrefs({ ...prefs, customSlashCommands: prefs.customSlashCommands.map((item, itemIndex) => itemIndex === index ? { ...item, template: e.target.value } : item) })} />
                          <button onClick={() => setPrefs({ ...prefs, customSlashCommands: prefs.customSlashCommands.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 /></button>
                        </div>
                      ))}
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
                        <b>기본 모델</b>
                        <small>AI 푸터에서 먼저 선택되는 모델</small>
                      </span>
                      <select
                        value={agents.defaultModel}
                        onChange={(e) =>
                          setAgents({
                            ...agents,
                            defaultModel: e.target.value,
                          })
                        }
                      >
                        <optgroup label="OpenAI">
                          {availableAiModels.filter((model) => model.provider === "codex").map((model) => (
                            <option key={model.id} value={model.id}>{model.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label="Anthropic">
                          {availableAiModels.filter((model) => model.provider === "claude").map((model) => (
                            <option key={model.id} value={model.id}>{model.label}</option>
                          ))}
                        </optgroup>
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
                        <button
                          className="diagnostic-button"
                          disabled={diagnostics[`agent-${id}`]?.loading}
                          onClick={async () => {
                            const key = `agent-${id}`;
                            setDiagnostics((current) => ({ ...current, [key]: { loading: true, message: "확인 중…" } }));
                            try {
                              const result = await window.ksnoteAI?.diagnose?.({ provider: id, command: agents[id].command });
                              setDiagnostics((current) => ({ ...current, [key]: { ...result, ok: Boolean(result?.installed) && result?.authenticated !== false, loading: false } }));
                            } catch (error) {
                              setDiagnostics((current) => ({ ...current, [key]: { ok: false, loading: false, message: error.message } }));
                            }
                          }}
                        >
                          다시 확인
                        </button>
                        {id === "codex" && diagnostics[`agent-${id}`]?.authenticated === false && (
                          <button
                            className="diagnostic-button"
                            onClick={async () => {
                              const key = "agent-codex";
                              setDiagnostics((current) => ({
                                ...current,
                                [key]: {
                                  loading: true,
                                  message: "브라우저에서 ChatGPT 로그인을 완료해 주세요.",
                                },
                              }));
                              try {
                                await window.ksnoteAI?.loginChatgpt?.({
                                  command: agents.codex.command,
                                });
                                setDiagnostics((current) => ({
                                  ...current,
                                  [key]: {
                                    loading: true,
                                    ok: false,
                                    authenticated: false,
                                    message: "로그인 창을 열었습니다. 완료하면 상태가 자동 갱신됩니다.",
                                  },
                                }));
                              } catch (error) {
                                setDiagnostics((current) => ({
                                  ...current,
                                  [key]: {
                                    loading: false,
                                    ok: false,
                                    message: error.message,
                                  },
                                }));
                              }
                            }}
                          >
                            ChatGPT로 로그인
                          </button>
                        )}
                        {diagnostics[`agent-${id}`] && (
                          <small className={`diagnostic-result ${diagnostics[`agent-${id}`].ok ? "ok" : "fail"}`}>
                            {diagnostics[`agent-${id}`].message}
                          </small>
                        )}
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
                    <section className="ksnote-mcp-guide">
                      <header>
                        <Workflow />
                        <span>
                          <b>Codex에서 현재 페이지에 다이어그램 저장</b>
                          <small>
                            페이지 상단의 <code>#</code>는 페이지 ID를, <code>타깃</code>은 현재 커서/선택 위치를 복사합니다.
                          </small>
                        </span>
                      </header>
                      <ol>
                        <li>아래 설정은 현재 실행 중인 KsNote 위치와 데이터 경로를 기준으로 생성됩니다.</li>
                        <li>노트에서 삽입할 위치를 클릭하고 <code>타깃</code>을 복사합니다.</li>
                        <li>Codex에 <code>@KsNote 현재 폴더 코드 구조 확인 후 이 타깃에 Mermaid 다이어그램 저장해줘</code>처럼 요청합니다.</li>
                      </ol>
                      <div className="ksnote-mcp-actions">
                        <button
                          onClick={registerKsNoteMcpForCodex}
                          disabled={mcpInstallStatus?.loading || !window.ksnoteMcp?.registerCodex}
                        >
                          <Terminal /> Codex 등록/업데이트
                        </button>
                        <button
                          onClick={() =>
                            copyText(
                              mcpInfo?.codexConfigToml || "",
                              "Codex MCP 설정을 복사했습니다",
                            )
                          }
                          disabled={!mcpInfo?.codexConfigToml}
                        >
                          <Copy /> Codex TOML 복사
                        </button>
                        <button
                          onClick={() =>
                            copyText(
                              mcpInfo?.claudeConfigJson || "",
                              "Claude MCP 설정을 복사했습니다",
                            )
                          }
                          disabled={!mcpInfo?.claudeConfigJson}
                        >
                          <Copy /> Claude JSON 복사
                        </button>
                      </div>
                      <div className="ksnote-mcp-actions secondary">
                        <small>
                          {mcpInfo?.isPackaged
                            ? "설치본은 앱 실행 파일을 Node 모드로 실행해 MCP 서버를 띄웁니다. 포터블 폴더를 옮기면 이 설정을 다시 복사하세요."
                            : "개발 모드는 현재 checkout의 MCP 스크립트를 직접 실행합니다."}
                        </small>
                      </div>
                      {mcpInstallStatus && (
                        <small
                          className={`diagnostic-result ${mcpInstallStatus.ok ? "ok" : mcpInstallStatus.loading ? "" : "fail"}`}
                          title={mcpInstallStatus.detail || mcpInstallStatus.message}
                        >
                          {mcpInstallStatus.message}
                        </small>
                      )}
                      <pre>{mcpInfo?.codexConfigToml || "KsNote 실행 위치를 확인하는 중..."}</pre>
                      {mcpInfo?.executablePath && (
                        <small className="ksnote-mcp-path">
                          앱: <code>{mcpInfo.executablePath}</code>
                        </small>
                      )}
                    </section>
                    <div className="mcp-list">
                      {mcpServers.map((server) => (
                        <div className="mcp-card" key={server.id}>
                          <span className="server-icon">
                            {server.icon === "calendar" ? <CalendarDays /> : server.icon === "mail" ? <Mail /> : server.icon === "rovo" ? <Zap /> : server.icon === "ksnote" ? <Workflow /> : <Server />}
                          </span>
                          <span className="server-info">
                            <input
                              value={server.name}
                              readOnly={server.managed}
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
                            {server.managed ? (
                              <small className="managed-mcp-description">{server.description}</small>
                            ) : <label>
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
                            </label>}
                            {!server.managed && <label>
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
                            </label>}
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
                          {!server.managed && <button
                            className="diagnostic-button"
                            disabled={diagnostics[`mcp-${server.id}`]?.loading}
                            onClick={() => testCommand(`mcp-${server.id}`, `${server.command} ${server.args || ""}`, "mcp")}
                          >
                            테스트
                          </button>}
                          {diagnostics[`mcp-${server.id}`] && (
                            <small className={`diagnostic-result ${diagnostics[`mcp-${server.id}`].ok ? "ok" : "fail"}`} title={diagnostics[`mcp-${server.id}`].message}>
                              {diagnostics[`mcp-${server.id}`].ok ? "연결됨" : "실패"}
                            </small>
                          )}
                          {!server.managed && <button
                            className="delete-server"
                            onClick={() =>
                              setMcpServers((s) =>
                                s.filter((x) => x.id !== server.id),
                              )
                            }
                          >
                            <Trash2 />
                          </button>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {settingsTab === "automation" && (
                  <>
                    <div className="setting-title">
                      <h3>자동화</h3>
                      <p>노트에서 발견한 일정, 메일과 업무 문맥을 연결합니다.</p>
                    </div>
                    <div className="automation-summary">
                      <span><Zap /></span>
                      <div>
                        <b>{activeAutomationCount}개 서비스 활성</b>
                        <small>연결을 켜도 외부 변경은 실행 전 확인을 거칩니다.</small>
                      </div>
                    </div>
                    <div className="automation-grid">
                      {MANAGED_MCP_SERVERS.filter((definition) => definition.category !== "local").map((definition) => {
                        const server = mcpServers.find((item) => item.id === definition.id) || definition;
                        const Icon = definition.icon === "calendar" ? CalendarDays : definition.icon === "mail" ? Mail : Zap;
                        return (
                          <article className={`automation-card ${server.enabled ? "enabled" : ""}`} key={definition.id}>
                            <header>
                              <span className={`automation-icon ${definition.icon}`}><Icon /></span>
                              <span className={`automation-state ${server.enabled ? "on" : ""}`}>
                                <i /> {server.enabled ? "활성" : "꺼짐"}
                              </span>
                            </header>
                            <div>
                              <b>{definition.name}</b>
                              <p>{definition.description}</p>
                            </div>
                            <footer>
                              <small>
                                {definition.id === "rovo" && diagnostics["mcp-rovo"]
                                  ? diagnostics["mcp-rovo"].message
                                  : server.enabled ? "MCP 사용 허용됨" : "연결하지 않음"}
                              </small>
                              <label className="switch">
                                <input
                                  type="checkbox"
                                  checked={Boolean(server.enabled)}
                                  onChange={(event) =>
                                    setMcpServers((servers) =>
                                      mergeManagedMcpServers(servers).map((item) =>
                                        item.id === definition.id
                                          ? { ...item, enabled: event.target.checked }
                                          : item,
                                      ),
                                    )
                                  }
                                />
                                <i />
                              </label>
                            </footer>
                          </article>
                        );
                      })}
                    </div>
                    <div className="automation-note">
                      <Shield />
                      <span>
                        <b>활성화는 접근 허용 상태만 저장합니다.</b>
                        <small>Google 계정 및 Atlassian 인증 연결은 후속 MCP 인증 단계에서 진행합니다.</small>
                      </span>
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
                    <div className="trash-section">
                      <div>
                        <span>
                          <h4>휴지통</h4>
                          <small>
                            삭제한 페이지를 복원하거나 영구 삭제합니다.
                          </small>
                        </span>
                        <em>{data.notes.filter((n) => n.trashed).length}</em>
                      </div>
                      {data.notes.filter((n) => n.trashed).length ? (
                        data.notes
                          .filter((n) => n.trashed)
                          .map((n) => (
                            <div className="trash-row" key={n.id}>
                              <FileText />
                              <span>
                                <b>{n.title}</b>
                                <small>
                                  {data.projects.find(
                                    (p) => p.id === n.projectId,
                                  )?.name || "삭제된 프로젝트"}
                                </small>
                              </span>
                              <button onClick={() => restoreNote(n.id)}>
                                복원
                              </button>
                              <button
                                className="danger"
                                onClick={() => deleteNotePermanently(n.id)}
                              >
                                영구 삭제
                              </button>
                            </div>
                          ))
                      ) : (
                        <p>휴지통이 비어 있습니다.</p>
                      )}
                    </div>
                    <div className="revision-section">
                      <div className="revision-heading">
                        <span>
                          <h4>변경 이력</h4>
                          <small>현재 페이지의 최근 버전을 최대 50개 보관합니다.</small>
                        </span>
                        <em>{revisions.length}</em>
                      </div>
                      {revisions.length ? (
                        revisions.map((revision) => (
                          <div className="revision-row" key={revision.id}>
                            <History />
                            <span>
                              <b>{revision.title || note?.title || "제목 없음"}</b>
                              <small>{new Date(revision.created_at).toLocaleString("ko-KR")}</small>
                            </span>
                            <button onClick={() => restoreRevision(revision.id)}>이 버전 복원</button>
                          </div>
                        ))
                      ) : (
                        <p>아직 저장된 이전 버전이 없습니다.</p>
                      )}
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
                {settingsTab === "developer" && (
                  <>
                    <div className="setting-title">
                      <h3>개발자 모드</h3>
                      <p>Ralph 검증을 위해 AI 질문부터 페이지 반영까지 한 실행 ID로 추적합니다.</p>
                    </div>
                    <div className="setting-row">
                      <span><b>AI 검증 로그</b><small>질문, 응답, 적용 전·후 페이지 HTML을 이 기기에만 최대 50건 저장</small></span>
                      <label className="switch"><input type="checkbox" checked={Boolean(prefs.developerMode)} onChange={(event) => setPrefs({ ...prefs, developerMode: event.target.checked })} /><i /></label>
                    </div>
                    <div className="developer-log-toolbar">
                      <span><b>Ralph 검증 로그</b><small>{aiDebugLogs.length}개 실행</small></span>
                      <button disabled={!aiDebugLogs.length} onClick={() => navigator.clipboard.writeText(JSON.stringify(aiDebugLogs, null, 2))}><Copy /> JSON 복사</button>
                      <button disabled={!aiDebugLogs.length} onClick={() => { localStorage.removeItem("ksnote-ai-debug-logs"); setAiDebugLogs([]); }}><Trash2 /> 초기화</button>
                    </div>
                    <div className="developer-log-list">
                      {!prefs.developerMode ? <p className="developer-log-empty">AI 검증 로그를 켜면 다음 요청부터 기록합니다.</p> : aiDebugLogs.length === 0 ? <p className="developer-log-empty">기록된 AI 실행이 없습니다.</p> : aiDebugLogs.map((log) => (
                        <details className="developer-log-entry" key={log.requestId}>
                          <summary><i className={`debug-status ${log.status}`} /><span><b>{log.prompt || "프롬프트 없음"}</b><small>{log.mode} · {log.provider} · {new Date(log.createdAt).toLocaleString("ko-KR")}</small></span><em>{log.status}</em></summary>
                          <div className="developer-log-flow"><span className={log.prompt ? "ok" : ""}>질문</span><i>→</i><span className={log.response ? "ok" : ""}>응답</span><i>→</i><span className={log.pageAfter ? "ok" : ""}>페이지 반영</span></div>
                          <label>Request ID<code>{log.requestId}</code></label>
                          <label>질문<pre>{log.prompt}</pre></label>
                          <label>AI 응답<pre>{log.response || log.error || "응답 대기 중"}</pre></label>
                          <label>적용 전 페이지<pre>{log.pageBefore || "캡처 없음"}</pre></label>
                          <label>적용 후 페이지<pre>{log.pageAfter || "아직 적용되지 않음"}</pre></label>
                        </details>
                      ))}
                    </div>
                    <div className="developer-log-toolbar">
                      <span><b>에디터 Enter 진단 로그</b><small>{editorDebugLogs.length}개 이벤트</small></span>
                      <button disabled={!editorDebugLogs.length} onClick={() => navigator.clipboard.writeText(JSON.stringify(editorDebugLogs, null, 2))}><Copy /> JSON 복사</button>
                      <button disabled={!editorDebugLogs.length} onClick={() => { localStorage.removeItem("ksnote-editor-debug-logs"); setEditorDebugLogs([]); }}><Trash2 /> 초기화</button>
                    </div>
                    <div className="developer-log-list">
                      {!prefs.developerMode ? <p className="developer-log-empty">개발자 모드를 켜면 Enter 입력을 기록합니다.</p> : editorDebugLogs.length === 0 ? <p className="developer-log-empty">기록된 Enter 이벤트가 없습니다.</p> : editorDebugLogs.map((log) => (
                        <details className="developer-log-entry" key={log.id}>
                          <summary><i className={`debug-status ${log.nodeTypeAfter === "heading" ? "error" : "complete"}`} /><span><b>{log.nodeTypeBefore} → {log.nodeTypeAfter}</b><small>{new Date(log.createdAt).toLocaleString("ko-KR")} · Shift {String(log.shiftKey)} · IME {String(log.isComposing || log.editorComposing)}</small></span><em>{log.atEndBefore ? "at end" : "not at end"}</em></summary>
                          <label>Enter 이벤트<pre>{JSON.stringify(log, null, 2)}</pre></label>
                        </details>
                      ))}
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
      {shortcutsOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShortcutsOpen(false);
          }}
        >
          <section className="shortcut-modal">
            <header>
              <span>
                <Keyboard />
                <span>
                  <h2>키보드 단축키</h2>
                  <p>마우스 없이 빠르게 문서를 편집합니다.</p>
                </span>
              </span>
              <button onClick={() => setShortcutsOpen(false)}>
                <X />
              </button>
            </header>
            <div>
              {[
                ["새 페이지", "Ctrl + N"],
                ["실행 취소", "Ctrl + Z"],
                ["다시 실행", "Ctrl + Y"],
                ["오른쪽 표 열 추가", "Ctrl + Alt + →"],
                ["아래 표 행 추가", "Ctrl + Alt + ↓"],
                ["코드 블록 나가기", "→ (코드 끝)"],
                ["Slash 명령", "/"],
                ["명령 선택", "↑ ↓ + Enter"],
                ["메뉴 닫기", "Esc"],
                ["할 일 중첩", "Tab / Shift + Tab"],
              ].map(([label, key]) => (
                <div key={label}>
                  <span>{label}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
            <footer>
              <button onClick={() => setShortcutsOpen(false)}>확인</button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
