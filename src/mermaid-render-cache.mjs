export const MERMAID_RENDER_DEBOUNCE_MS = 240;

const normalizeCode = (code) => String(code || "");

const remember = (cache, key, value, limit) => {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  while (cache.size > limit) cache.delete(cache.keys().next().value);
};

export const createMermaidRenderCache = (
  renderSvg,
  { maxEntries = 80 } = {},
) => {
  if (typeof renderSvg !== "function")
    throw new TypeError("Mermaid SVG renderer must be a function");

  const cache = new Map();
  const pendingByCode = new Map();
  const cacheLimit = Math.max(1, Number(maxEntries) || 80);
  let renderSequence = 0;

  const peek = (code) => {
    const key = normalizeCode(code);
    if (!cache.has(key)) return null;
    const result = cache.get(key);
    remember(cache, key, result, cacheLimit);
    return result;
  };

  const pending = (code) =>
    pendingByCode.get(normalizeCode(code)) || null;

  const render = (code) => {
    const key = normalizeCode(code);
    const cached = peek(key);
    if (cached) return Promise.resolve(cached);

    const active = pending(key);
    if (active) return active;

    renderSequence += 1;
    const renderId = renderSequence;
    let request;
    request = Promise.resolve()
      .then(() => renderSvg(key, renderId))
      .then((svg) => ({ ok: true, svg: String(svg || ""), error: "" }))
      .catch((error) => ({
        ok: false,
        svg: "",
        error: error?.message || String(error),
      }))
      .then((result) => {
        remember(cache, key, result, cacheLimit);
        return result;
      })
      .finally(() => {
        if (pendingByCode.get(key) === request) pendingByCode.delete(key);
      });
    pendingByCode.set(key, request);
    return request;
  };

  return {
    peek,
    pending,
    render,
    clear() {
      cache.clear();
      pendingByCode.clear();
    },
    get cacheSize() {
      return cache.size;
    },
  };
};

const escapeRegExp = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const scopeMermaidSvg = (svg, scope) => {
  const source = String(svg || "");
  const safeScope = `ks-${String(scope || "render")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 80)}`;
  const ids = new Map();

  for (const match of source.matchAll(/\bid=(["'])([^"']+)\1/g)) {
    if (!ids.has(match[2]))
      ids.set(
        match[2],
        `${safeScope}-${ids.size}-${match[2].replace(/[^a-zA-Z0-9_-]/g, "-")}`,
      );
  }
  if (!ids.size) return source;

  let scoped = source.replace(
    /\bid=(["'])([^"']+)\1/g,
    (match, quote, id) =>
      ids.has(id) ? `id=${quote}${ids.get(id)}${quote}` : match,
  );
  scoped = scoped.replace(
    /url\(\s*(["']?)#([^)"'\s]+)\1\s*\)/g,
    (match, quote, id) =>
      ids.has(id) ? `url(${quote}#${ids.get(id)}${quote})` : match,
  );
  scoped = scoped.replace(
    /\b((?:xlink:)?href)=(["'])#([^"']+)\2/g,
    (match, attribute, quote, id) =>
      ids.has(id)
        ? `${attribute}=${quote}#${ids.get(id)}${quote}`
        : match,
  );
  scoped = scoped.replace(
    /\b(aria-labelledby|aria-describedby)=(["'])([^"']*)\2/g,
    (match, attribute, quote, value) => {
      const references = value
        .split(/\s+/)
        .map((id) => ids.get(id) || id)
        .join(" ");
      return `${attribute}=${quote}${references}${quote}`;
    },
  );
  scoped = scoped.replace(
    /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (match, opening, css, closing) => {
      let scopedCss = css;
      [...ids.entries()]
        .sort(([left], [right]) => right.length - left.length)
        .forEach(([id, replacement]) => {
          scopedCss = scopedCss.replace(
            new RegExp(`#${escapeRegExp(id)}(?![a-zA-Z0-9_-])`, "g"),
            `#${replacement}`,
          );
        });
      return `${opening}${scopedCss}${closing}`;
    },
  );
  return scoped;
};
