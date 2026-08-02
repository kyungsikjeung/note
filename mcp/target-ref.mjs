const finiteNumber = (value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const buildKsNoteTargetRef = ({
  pageId,
  blockId,
  offset,
  toBlockId,
  toOffset,
  from,
  to,
  revision,
  operation,
} = {}) => {
  if (!pageId) throw new Error("KsNote pageId가 필요합니다.");
  const params = new URLSearchParams();
  if (blockId) params.set("block", blockId);
  if (Number.isFinite(offset)) params.set("offset", String(offset));
  if (toBlockId) params.set("toBlock", toBlockId);
  if (Number.isFinite(toOffset)) params.set("toOffset", String(toOffset));
  if (Number.isFinite(from)) params.set("from", String(from));
  if (Number.isFinite(to)) params.set("to", String(to));
  if (revision) params.set("revision", revision);
  if (operation) params.set("operation", operation);
  const query = params.toString();
  return `ksnote://page/${encodeURIComponent(pageId)}${query ? `?${query}` : ""}`;
};

export const parseKsNoteTargetRef = (targetRef) => {
  const value = String(targetRef || "").trim();
  const match = value.match(/^ksnote:\/\/page\/([^?]+)(?:\?(.*))?$/);
  if (!match) return null;
  const params = new URLSearchParams(match[2] || "");
  const operation = params.get("operation") || undefined;
  return {
    pageId: decodeURIComponent(match[1]),
    blockId: params.get("block") || undefined,
    offset: finiteNumber(params.get("offset")),
    toBlockId: params.get("toBlock") || undefined,
    toOffset: finiteNumber(params.get("toOffset")),
    from: finiteNumber(params.get("from")),
    to: finiteNumber(params.get("to")),
    revision: params.get("revision") || undefined,
    operation,
    explicit: true,
  };
};
