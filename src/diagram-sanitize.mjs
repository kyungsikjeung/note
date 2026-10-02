// DOMPurify drops an attribute whose value contains "-->" (comment-breakout
// guard), which wipes `data-code` of virtually every Mermaid flowchart
// (`A --> B`) during sanitize. Protect diagram codes with inert tokens before
// sanitizing and restore them afterwards. Tokens are alphanumeric plus
// underscores so they always survive the sanitizer.
export const DIAGRAM_CODE_SELECTOR =
  'div[data-type="mermaid"][data-code],div[data-type="plantuml"][data-code],div[data-type="drawio"][data-code]';

export const protectDiagramCodes = (root, prefix) => {
  const codes = new Map();
  root.querySelectorAll(DIAGRAM_CODE_SELECTOR).forEach((element, index) => {
    const token = `__KSNOTE_${prefix}_${index}__`;
    codes.set(token, element.getAttribute("data-code") || "");
    element.setAttribute("data-code", token);
  });
  return codes;
};

export const restoreDiagramCodes = (root, codes) => {
  if (!codes?.size) return;
  root.querySelectorAll(DIAGRAM_CODE_SELECTOR).forEach((element) => {
    const code = codes.get(element.getAttribute("data-code"));
    if (code !== undefined) element.setAttribute("data-code", code);
  });
};
