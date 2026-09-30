const MCP_WRITE_TYPES = new Set([
  "note_create",
  "diagram_insert",
  "diagram_delete",
  "text_insert",
  "note_patch",
  "note_move",
  "task_update",
  "history_restore",
]);

export const isMcpWriteOperation = (operation) =>
  MCP_WRITE_TYPES.has(String(operation?.type || ""));

export const requiresMcpUserApproval = (operation) =>
  isMcpWriteOperation(operation) && operation?.status === "pending";

export const isApprovedMcpOperation = (operation) =>
  isMcpWriteOperation(operation) && operation?.status === "approved";
