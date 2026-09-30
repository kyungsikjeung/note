// S3 Revision 공용 모듈 — 스키마 변경 없음, 읽기 코드 이동만.
// MCP 서버(mcp/ksnote-server.mjs), 렌더러(src/main.jsx),
// 에디터(src/RichDocumentEditor.jsx)가 각자 들고 있던 FNV-1a 해시를
// 단일 구현으로 통일한다. revision 포맷 `r<hex>`는 그대로 유지된다.

export const contentRevision = (value) => {
  let hash = 2166136261;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `r${(hash >>> 0).toString(16)}`;
};

export const noteRevision = (note) => contentRevision(note?.content);

export const resolveGuardedRevision = ({ expectedRevision, targetRevision } = {}) =>
  expectedRevision || targetRevision || undefined;

export const isRevisionConflict = (guardedRevision, currentRevision) =>
  Boolean(guardedRevision && guardedRevision !== currentRevision);
