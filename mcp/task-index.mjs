import { listTaskItems } from "./note-html.mjs";

export const buildTaskIndex = (notes = [], sourceUpdatedAt = 0) => {
  const tasks = [];
  for (const note of notes || []) {
    if (!note || note.trashed) continue;
    for (const task of listTaskItems(note.content)) {
      tasks.push({
        id: `${note.id}-${task.index}`,
        noteId: note.id,
        noteTitle: note.title || "",
        projectId: note.projectId,
        index: task.index,
        text: task.text,
        checked: task.checked,
        dueDate: task.dueDate,
        assignee: task.assignee,
        priority: task.priority,
      });
    }
  }
  return { version: 1, sourceUpdatedAt: Number(sourceUpdatedAt) || 0, tasks };
};

export const queryTaskIndex = (index, filters = {}) => {
  const {
    projectId,
    noteId,
    checked,
    assignee,
    limit,
    offset,
  } = filters;
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const wantedAssignee = String(assignee || "").trim().toLowerCase();
  const tasks = (index?.tasks || []).filter((task) => {
    if (!task) return false;
    if (projectId && task.projectId !== projectId) return false;
    if (noteId && task.noteId !== noteId) return false;
    if (checked !== undefined && task.checked !== checked) return false;
    if (
      wantedAssignee &&
      String(task.assignee || "").toLowerCase() !== wantedAssignee
    )
      return false;
    return true;
  });
  return {
    total: tasks.length,
    limit: safeLimit,
    offset: safeOffset,
    tasks: tasks.slice(safeOffset, safeOffset + safeLimit),
  };
};

export const isIndexFresh = (index, sourceUpdatedAt) =>
  Boolean(index) &&
  Number(index.sourceUpdatedAt) === Number(sourceUpdatedAt) &&
  Array.isArray(index.tasks);
