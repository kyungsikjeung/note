const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const toNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const latestRevisionBefore = (revisions, timestamp) =>
  revisions
    .filter((row) => Number(row.created_at) < Number(timestamp))
    .sort((a, b) => Number(b.created_at) - Number(a.created_at))[0] || null;

export const buildHistoryList = ({
  revisions = [],
  operations = [],
  limit,
  offset,
} = {}) => {
  const safeLimit = Math.min(
    MAX_LIMIT,
    Math.max(1, toNumber(limit, DEFAULT_LIMIT)),
  );
  const safeOffset = Math.max(0, toNumber(offset, 0));
  const entries = [];
  for (const row of revisions) {
    entries.push({
      kind: "revision",
      revisionId: Number(row.id),
      title: row.title || "",
      createdAt: Number(row.created_at) || 0,
      restorable: true,
    });
  }
  for (const operation of operations) {
    if (!operation?.id) continue;
    if (!["completed", "error"].includes(operation.status)) continue;
    const anchor = Number(operation.updatedAt || operation.createdAt) || 0;
    const restoreRevision = latestRevisionBefore(revisions, Number(operation.createdAt) || 0);
    entries.push({
      kind: "mcp-operation",
      operationId: operation.id,
      type: operation.type || "unknown",
      status: operation.status,
      code: operation.code,
      format: operation.format,
      createdAt: anchor,
      appliedRevision: operation.appliedRevision,
      restoreRevisionId: restoreRevision ? Number(restoreRevision.id) : undefined,
      restorable:
        operation.status === "completed" && Boolean(restoreRevision),
    });
  }
  entries.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  return {
    total: entries.length,
    limit: safeLimit,
    offset: safeOffset,
    entries: entries.slice(safeOffset, safeOffset + safeLimit),
  };
};

export const resolveRestoreSnapshot = ({
  revisions = [],
  operations = [],
  revisionId,
  operationId,
} = {}) => {
  if (revisionId !== undefined && revisionId !== null && revisionId !== "") {
    const row = revisions.find(
      (entry) => Number(entry.id) === Number(revisionId),
    );
    if (!row) return { ok: false, code: "revision_not_found" };
    return {
      ok: true,
      revisionId: Number(row.id),
      content: String(row.content || ""),
      source: "revision",
    };
  }
  if (operationId) {
    const operation = operations.find((entry) => entry.id === operationId);
    if (!operation) return { ok: false, code: "operation_not_found" };
    if (operation.status !== "completed")
      return { ok: false, code: "operation_not_restorable" };
    const restoreRevision = latestRevisionBefore(
      revisions,
      Number(operation.createdAt) || 0,
    );
    if (!restoreRevision) return { ok: false, code: "restore_snapshot_missing" };
    return {
      ok: true,
      revisionId: Number(restoreRevision.id),
      content: String(restoreRevision.content || ""),
      source: "mcp-operation",
      sourceOperationId: operation.id,
    };
  }
  return { ok: false, code: "restore_target_required" };
};
