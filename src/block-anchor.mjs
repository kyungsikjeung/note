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
