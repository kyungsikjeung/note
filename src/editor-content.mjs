const EDITABLE_DIAGRAM_TYPES = new Set([
  "mermaidBlock",
  "plantUmlBlock",
  "drawIoBlock",
]);

const CALLOUT_VARIANTS = new Set(["info", "warn", "warning"]);

export const normalizeCalloutVariant = (variant) =>
  variant === "warn" || variant === "warning" ? "warning" : "info";

export const calloutBlock = (variant) => {
  if (!CALLOUT_VARIANTS.has(variant))
    throw new TypeError(`Unsupported callout variant: ${variant}`);

  return {
    type: "calloutBlock",
    attrs: { variant: normalizeCalloutVariant(variant) },
    content: [{ type: "paragraph" }],
  };
};

export const editableDiagramBlock = (type, attrs) => {
  if (!EDITABLE_DIAGRAM_TYPES.has(type))
    throw new TypeError(`Unsupported diagram block type: ${type}`);

  return {
    type,
    ...(attrs && Object.keys(attrs).length ? { attrs: { ...attrs } } : {}),
  };
};

export const editableDiagramWithTrailingParagraph = (type, attrs) => [
  editableDiagramBlock(type, attrs),
  { type: "paragraph" },
];
