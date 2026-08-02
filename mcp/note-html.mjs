const readAttribute = (attributes, name) => {
  const match = String(attributes || "").match(
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"),
  );
  return match?.[2];
};

export const findDiagramBlock = (html, blockId) => {
  const requestedId = String(blockId || "").trim();
  if (!requestedId) return null;
  const source = String(html || "");
  const blockPattern = /<div\b([^>]*)><\/div>/gi;
  let match;
  while ((match = blockPattern.exec(source))) {
    const attributes = match[1];
    if (readAttribute(attributes, "data-block-id") !== requestedId) continue;
    const format = readAttribute(attributes, "data-type")?.toLowerCase();
    if (!["mermaid", "plantuml", "drawio"].includes(format)) return null;
    return {
      blockId: requestedId,
      format,
      code: readAttribute(attributes, "data-code") || "",
      start: match.index,
      end: blockPattern.lastIndex,
      html: match[0],
    };
  }
  return null;
};

export const listEmptyDiagramBlocks = (html) => {
  const source = String(html || "");
  const blockPattern = /<div\b([^>]*)><\/div>/gi;
  const blocks = [];
  let match;
  while ((match = blockPattern.exec(source))) {
    const attributes = match[1];
    const format = readAttribute(attributes, "data-type")?.toLowerCase();
    if (!["mermaid", "plantuml", "drawio"].includes(format)) continue;
    const blockId = readAttribute(attributes, "data-block-id");
    const code = readAttribute(attributes, "data-code") || "";
    if (blockId && !code.trim()) blocks.push({ blockId, format });
  }
  return blocks;
};
