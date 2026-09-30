const PATCH_OPERATIONS = new Set(["replace", "insert_before", "insert_after"]);
const PATCH_TARGETS = new Set(["note", "selection", "block", "table"]);

export const validateAIPatch = (value, context = {}) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "patch_not_object", message: "AI Patch가 객체가 아닙니다." };
  if (value.version !== 1) return { ok: false, code: "patch_version_invalid", message: "지원하지 않는 AI Patch version입니다." };
  if (!PATCH_OPERATIONS.has(value.operation)) return { ok: false, code: "patch_operation_invalid", message: "AI Patch operation이 유효하지 않습니다." };
  if (!PATCH_TARGETS.has(value.target)) return { ok: false, code: "patch_target_invalid", message: "AI Patch target이 유효하지 않습니다." };
  if (typeof value.html !== "string") return { ok: false, code: "patch_html_invalid", message: "AI Patch html이 문자열이 아닙니다." };
  if (context.target && value.target !== context.target) return { ok: false, code: "patch_target_mismatch", message: "AI Patch의 target이 요청한 편집 범위와 다릅니다." };
  if (context.operation && value.operation !== context.operation) return { ok: false, code: "patch_operation_mismatch", message: "AI Patch의 operation이 요청한 편집 방식과 다릅니다." };
  if (value.target === "block" && (typeof value.blockId !== "string" || !value.blockId.trim())) return { ok: false, code: "patch_block_required", message: "block 대상 AI Patch에는 blockId가 필요합니다." };
  if (value.target === "block" && context.blockId && value.blockId !== context.blockId) return { ok: false, code: "patch_block_mismatch", message: "AI Patch의 blockId가 실행 대상과 일치하지 않습니다." };
  if (context.sourceRevision && value.expectedRevision !== context.sourceRevision) return { ok: false, code: "patch_revision_mismatch", message: "AI Patch의 expectedRevision이 없거나 요청한 문서와 다릅니다." };
  return { ok: true, patch: value };
};

export const parseAIPatch = (value, context = {}) => {
  const raw = String(value ?? "").trim();
  const fenced = raw.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  let patch;
  try {
    patch = JSON.parse(fenced ? fenced[1].trim() : raw);
  } catch {
    throw Object.assign(new Error("AI 편집 응답이 유효한 JSON Patch가 아닙니다. 결과를 다시 요청해 주세요."), { code: "patch_json_invalid" });
  }
  const validation = validateAIPatch(patch, context);
  if (!validation.ok)
    throw Object.assign(new Error(validation.message), { code: validation.code });
  return validation.patch;
};
