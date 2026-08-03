const EDITABLE_DIAGRAM_TYPES = new Set([
  "mermaidBlock",
  "plantUmlBlock",
  "drawIoBlock",
]);

export const editableDiagramBlock = (type, attrs) => {
  if (!EDITABLE_DIAGRAM_TYPES.has(type))
    throw new TypeError(`Unsupported diagram block type: ${type}`);

  return {
    type,
    ...(attrs && Object.keys(attrs).length ? { attrs: { ...attrs } } : {}),
  };
};
