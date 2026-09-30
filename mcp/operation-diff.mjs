import {
  findBlockById,
  findDiagramBlock,
  listTaskItems,
} from "./note-html.mjs";

const DIFF_SIDE_LIMIT = 6000;

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeAttribute = (value) =>
  escapeHtml(value).replace(/\n/g, "&#10;");

const textToHtml = (value) => {
  const text = String(value ?? "");
  if (!text) return "<p>(비어 있음)</p>";
  return `<p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
};

const capSide = (html) => {
  const source = String(html || "");
  if (source.length <= DIFF_SIDE_LIMIT)
    return { html: source, truncated: false };
  return { html: `${source.slice(0, DIFF_SIDE_LIMIT)}<p>(이하 생략)</p>`, truncated: true };
};

const diagramBlockHtml = (operation) => {
  const type = String(operation?.format || "mermaid").toLowerCase();
  return `<div data-type="${escapeAttribute(type)}" data-code="${escapeAttribute(operation?.code || "")}"></div>`;
};

const taskSummary = (task) => {
  if (!task) return "(할 일을 찾을 수 없습니다)";
  const box = task.checked ? "☑" : "☐";
  const meta = [
    task.assignee ? `담당자 ${task.assignee}` : "",
    task.dueDate ? `마감 ${task.dueDate}` : "",
    task.priority && task.priority !== "normal" ? `우선순위 ${task.priority}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `${box} ${task.text}${meta ? ` (${meta})` : ""}`;
};

export const buildOperationDiff = (operation = {}, context = {}) => {
  const type = String(operation?.type || "");
  const noteContent = String(context.noteContent || "");
  const finish = ({ mode, beforeLabel, afterLabel, beforeHtml, afterHtml }) => {
    const before = capSide(beforeHtml);
    const after = capSide(afterHtml);
    return {
      mode,
      beforeLabel,
      afterLabel,
      beforeHtml: before.html,
      afterHtml: after.html,
      truncated: before.truncated || after.truncated,
    };
  };

  if (type === "note_create") {
    return finish({
      mode: "create",
      beforeLabel: "변경 전 (새 페이지)",
      afterLabel: `변경 후 (${operation.title || "제목 없음"})`,
      beforeHtml: "<p>(없음)</p>",
      afterHtml: operation.content ? operation.content : "<p>(빈 페이지)</p>",
    });
  }

  if (type === "diagram_insert") {
    const afterHtml = diagramBlockHtml(operation);
    if (operation.operation === "replace-block" && operation.target?.blockId) {
      const block = findDiagramBlock(noteContent, operation.target.blockId);
      return finish({
        mode: "replace",
        beforeLabel: "변경 전 (기존 다이어그램)",
        afterLabel: "변경 후 (새 다이어그램)",
        beforeHtml: block ? block.html : "<p>(블록을 찾을 수 없습니다)</p>",
        afterHtml,
      });
    }
    return finish({
      mode: "insert",
      beforeLabel: "변경 전 (삽입 위치)",
      afterLabel: "변경 후 (삽입될 다이어그램)",
      beforeHtml: "<p>(현재 커서·선택 위치, 기존 내용은 유지됩니다)</p>",
      afterHtml,
    });
  }

  if (type === "diagram_delete") {
    const block = operation.target?.blockId
      ? findDiagramBlock(noteContent, operation.target.blockId)
      : null;
    return finish({
      mode: "delete",
      beforeLabel: "변경 전 (삭제될 다이어그램)",
      afterLabel: "변경 후",
      beforeHtml: block ? block.html : "<p>(블록을 찾을 수 없습니다)</p>",
      afterHtml: "<p>(삭제됨)</p>",
    });
  }

  if (type === "text_insert") {
    return finish({
      mode: operation.operation === "replace-selection" ? "replace" : "insert",
      beforeLabel: "변경 전 (삽입 위치)",
      afterLabel: "변경 후 (삽입될 텍스트)",
      beforeHtml: "<p>(현재 커서·선택 위치, 기존 내용은 유지됩니다)</p>",
      afterHtml: textToHtml(operation.text),
    });
  }

  if (type === "note_patch") {
    const block = operation.blockId ? findBlockById(noteContent, operation.blockId) : null;
    return finish({
      mode: "replace",
      beforeLabel: "변경 전 (기존 블록)",
      afterLabel: "변경 후 (교체될 블록)",
      beforeHtml: block ? block.html : "<p>(블록을 찾을 수 없습니다)</p>",
      afterHtml: operation.html || "<p>(비어 있음)</p>",
    });
  }

  if (type === "task_update") {
    const tasks = listTaskItems(noteContent);
    const task = tasks[operation.taskIndex];
    const patch = operation.patch && typeof operation.patch === "object" ? operation.patch : {};
    const after = task ? { ...task } : null;
    if (after) {
      if (patch.checked !== undefined) after.checked = patch.checked;
      if (patch.dueDate !== undefined) after.dueDate = String(patch.dueDate);
      if (patch.assignee !== undefined) after.assignee = String(patch.assignee);
      if (patch.priority !== undefined) after.priority = patch.priority;
    }
    return finish({
      mode: "replace",
      beforeLabel: "변경 전 (할 일)",
      afterLabel: "변경 후 (할 일)",
      beforeHtml: textToHtml(taskSummary(task)),
      afterHtml: textToHtml(taskSummary(after)),
    });
  }

  if (type === "history_restore") {
    return finish({
      mode: "replace",
      beforeLabel: "변경 전 (현재 페이지)",
      afterLabel: "변경 후 (복원될 스냅샷)",
      beforeHtml: noteContent || "<p>(비어 있음)</p>",
      afterHtml: operation.content || "<p>(비어 있음)</p>",
    });
  }

  if (type === "note_move") {
    return finish({
      mode: "move",
      beforeLabel: "변경 전 (소속 프로젝트)",
      afterLabel: "변경 후 (이동할 프로젝트)",
      beforeHtml: textToHtml(context.projectName || operation.projectId || ""),
      afterHtml: textToHtml(context.targetProjectName || operation.targetProjectId || ""),
    });
  }

  return finish({
    mode: "replace",
    beforeLabel: "변경 전",
    afterLabel: "변경 후",
    beforeHtml: "<p>(미리보기를 만들 수 없는 작업입니다)</p>",
    afterHtml: textToHtml(
      operation.code || operation.text || operation.content || operation.title || "",
    ),
  });
};
