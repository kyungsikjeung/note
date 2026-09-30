export const resolveBlockOffset = (doc, blockId, offset = 0) => {
  if (!blockId) return undefined;
  let resolved;
  doc.descendants((node, pos) => {
    if (resolved !== undefined || node.attrs?.blockId !== blockId) return;
    const contentSize = Math.max(0, node.content.size);
    resolved = pos + 1 + Math.min(Math.max(0, offset), contentSize);
  });
  return resolved;
};

export const resolveBlockNode = (doc, blockId) => {
  if (!blockId) return null;
  let resolved = null;
  doc.descendants((node, pos) => {
    if (resolved || node.attrs?.blockId !== blockId) return;
    resolved = { node, pos };
  });
  return resolved;
};

export const blockAnchorAt = (doc, resolvedPos, absolutePos) => {
  const direct = doc.nodeAt(absolutePos);
  if (direct?.attrs?.blockId) return { blockId: direct.attrs.blockId, offset: 0 };
  for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
    const node = resolvedPos.node(depth);
    if (!node.attrs?.blockId) continue;
    return {
      blockId: node.attrs.blockId,
      offset: Math.max(0, absolutePos - resolvedPos.before(depth) - 1),
    };
  }
  return { blockId: undefined, offset: undefined };
};

export const getActiveBlockContext = (editor) => {
  const { from, to, $from, $to } = editor.state.selection;
  if (from !== to) {
    const start = blockAnchorAt(editor.state.doc, $from, from);
    const end = blockAnchorAt(editor.state.doc, $to, to);
    return {
      target: "selection", range: { from, to }, nodeType: "selection", label: "선택 영역",
      blockId: start.blockId, blockOffset: start.offset,
      toBlockId: end.blockId, toBlockOffset: end.offset,
    };
  }
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (!node.isTextblock) continue;
    return {
      target: "block",
      range: { from: $from.before(depth), to: $from.after(depth) },
      nodeType: node.type.name,
      blockId: node.attrs?.blockId || undefined,
      label: node.type.name === "codeBlock" ? "현재 코드 블록" : node.type.name === "heading" ? "현재 제목" : "현재 문단",
      cursorOffset: $from.parentOffset,
      ancestors: Array.from({ length: depth }, (_, index) => $from.node(index + 1).type.name),
    };
  }
  return { target: "note", range: null, nodeType: "doc", label: "전체 노트" };
};

export const resolveAIEditRange = (doc, target, currentHtml) => {
  const conflict = () => {
    throw new Error("AI 실행 후 대상 내용이 변경되거나 삭제되었습니다. 결과를 다시 요청해 주세요.");
  };
  let range = target.range;
  if (target.target === "block" && target.blockId) {
    const resolved = resolveBlockNode(doc, target.blockId);
    if (!resolved) return conflict();
    range = { from: resolved.pos, to: resolved.pos + resolved.node.nodeSize };
  } else if (target.target === "selection" && target.blockId && target.toBlockId) {
    const from = resolveBlockOffset(doc, target.blockId, target.blockOffset ?? 0);
    const to = resolveBlockOffset(doc, target.toBlockId, target.toBlockOffset ?? 0);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return conflict();
    range = { from, to };
  } else if (target.originalHtml !== currentHtml) return conflict();
  if (!range || range.from < 0 || range.to < range.from || range.to > doc.content.size)
    return conflict();
  // Stable IDs locate a moved target; they do not prove its content is unchanged.
  if (!target.originalSlice || !target.originalSlice.eq(doc.slice(range.from, range.to)))
    return conflict();
  return range;
};
