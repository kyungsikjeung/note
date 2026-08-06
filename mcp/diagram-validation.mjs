const MERMAID_DECLARATION = /^(?:---[\s\S]*?---\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|mindmap|timeline|quadrantChart|xychart-beta|block-beta|architecture-beta|gitGraph|C4\w*)\b/i;

const parseMarkdownFence = (line) => {
  const match = String(line || "").match(/^\s*(`{3,})\s*([^`]*)\s*$/);
  if (!match) return null;
  return {
    size: match[1].length,
    language: match[2].trim().toLowerCase().split(/\s+/)[0] || "",
  };
};

const isMermaidFenceLanguage = (language) =>
  ["", "mermaid"].includes(language);

const unwrapMarkdownFence = (value) => {
  const lines = String(value || "").split("\n");
  if (lines.length < 2) return null;
  const opening = parseMarkdownFence(lines[0]);
  const closing = parseMarkdownFence(lines.at(-1));
  if (
    !opening ||
    !closing ||
    closing.language ||
    closing.size < opening.size ||
    !isMermaidFenceLanguage(opening.language)
  )
    return null;
  return lines.slice(1, -1).join("\n").trim();
};

const attributeMap = (tag) => {
  const attributes = {};
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attributes[match[1]] = match[2] ?? match[3] ?? "";
  return attributes;
};

const validateDrawIo = (code) => {
  if (/<!DOCTYPE|<!ENTITY/i.test(code))
    return {
      ok: false,
      code: "drawio_unsafe_xml",
      message: "draw.io XML에는 DOCTYPE 또는 ENTITY 선언을 사용할 수 없습니다.",
    };
  if (!/<mxfile\b[\s\S]*<diagram\b[\s\S]*<mxGraphModel\b[\s\S]*<root\b[\s\S]*<\/root>[\s\S]*<\/mxGraphModel>[\s\S]*<\/diagram>[\s\S]*<\/mxfile>\s*$/i.test(code))
    return {
      ok: false,
      code: "drawio_structure_invalid",
      message: "draw.io 소스는 mxfile/diagram/mxGraphModel/root 구조를 포함해야 합니다.",
    };

  const cells = [...code.matchAll(/<mxCell\b[^>]*>/gi)].map((match) =>
    attributeMap(match[0]),
  );
  const ids = new Set();
  for (const cell of cells) {
    if (!cell.id)
      return {
        ok: false,
        code: "drawio_cell_id_missing",
        message: "모든 draw.io mxCell에는 id가 있어야 합니다.",
      };
    if (ids.has(cell.id))
      return {
        ok: false,
        code: "drawio_duplicate_cell_id",
        message: `draw.io mxCell id가 중복되었습니다: ${cell.id}`,
      };
    ids.add(cell.id);
  }
  if (!ids.has("0") || !ids.has("1"))
    return {
      ok: false,
      code: "drawio_root_cells_missing",
      message: "draw.io 루트 셀 id=0과 기본 레이어 id=1이 필요합니다.",
    };

  const vertices = cells.filter((cell) => cell.vertex === "1");
  const edges = cells.filter((cell) => cell.edge === "1");
  if (!vertices.length)
    return {
      ok: false,
      code: "drawio_no_vertices",
      message: "draw.io 다이어그램에는 표시할 vertex mxCell이 하나 이상 필요합니다.",
    };
  for (const cell of [...vertices, ...edges]) {
    if (!cell.parent || !ids.has(cell.parent))
      return {
        ok: false,
        code: "drawio_parent_missing",
        message: `draw.io 셀 ${cell.id}의 parent를 찾을 수 없습니다.`,
      };
  }
  for (const edge of edges) {
    if (!edge.source || !ids.has(edge.source) || !edge.target || !ids.has(edge.target))
      return {
        ok: false,
        code: "drawio_edge_endpoint_missing",
        message: `draw.io edge ${edge.id}의 source/target이 유효하지 않습니다.`,
      };
  }
  return {
    ok: true,
    details: {
      pages: (code.match(/<diagram\b/gi) || []).length,
      cells: cells.length,
      vertices: vertices.length,
      edges: edges.length,
    },
  };
};

export const validateDiagramSource = (formatValue, value) => {
  const format = String(formatValue || "mermaid").trim().toLowerCase();
  const code = String(value || "").trim();
  if (!new Set(["mermaid", "plantuml", "drawio"]).has(format))
    return {
      ok: false,
      code: "diagram_format_unsupported",
      format,
      message: `지원하지 않는 다이어그램 형식입니다: ${format}`,
    };
  if (!code)
    return {
      ok: false,
      code: "diagram_empty",
      format,
      message: "다이어그램 소스가 비어 있습니다.",
    };
  if (/^```|```$/m.test(code))
    return {
      ok: false,
      code: "diagram_code_fence",
      format,
      message: "코드 펜스를 제외한 다이어그램 소스만 전달해 주세요.",
    };
  if (format === "mermaid" && !MERMAID_DECLARATION.test(code))
    return {
      ok: false,
      code: "mermaid_declaration_invalid",
      format,
      message: "지원되는 Mermaid 다이어그램 선언으로 시작해야 합니다.",
    };
  if (format === "plantuml" && !/^@startuml\b[\s\S]*@enduml\s*$/i.test(code))
    return {
      ok: false,
      code: "plantuml_boundary_invalid",
      format,
      message: "PlantUML 소스는 @startuml로 시작하고 @enduml로 끝나야 합니다.",
    };
  const drawIoResult = format === "drawio" ? validateDrawIo(code) : { ok: true };
  if (!drawIoResult.ok) return { ...drawIoResult, format };
  return {
    ok: true,
    format,
    code,
    details: drawIoResult.details || {},
  };
};

export const normalizeMermaidPaste = (value) => {
  const original = String(value || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!original) return null;

  let code = original;
  let fenceRemoved = false;
  for (let depth = 0; depth < 8; depth += 1) {
    const unwrapped = unwrapMarkdownFence(code);
    if (unwrapped !== null) {
      code = unwrapped;
      fenceRemoved = true;
      continue;
    }

    const lines = code.split("\n");
    const opening = parseMarkdownFence(lines[0]);
    if (opening && isMermaidFenceLanguage(opening.language)) {
      code = lines.slice(1).join("\n").trim();
      fenceRemoved = true;
      continue;
    }

    const closing = parseMarkdownFence(lines.at(-1));
    if (closing && !closing.language) {
      code = lines.slice(0, -1).join("\n").trim();
      fenceRemoved = true;
      continue;
    }
    break;
  }

  const validation = validateDiagramSource("mermaid", code);
  if (!validation.ok) return null;
  return { code: validation.code, fenceRemoved };
};
