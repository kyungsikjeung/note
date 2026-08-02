const DRAWIO_VIEW_MODES = new Set(["edit", "source", "preview"]);

export const DRAWIO_ZOOM_MIN = 0.25;
export const DRAWIO_ZOOM_MAX = 4;
export const DRAWIO_ZOOM_STEP = 0.25;

export const normalizeDrawioView = (value, fallback = "edit") => {
  const normalized = String(value || "").trim().toLowerCase();
  return DRAWIO_VIEW_MODES.has(normalized) ? normalized : fallback;
};

export const isDrawioSvgDataUrl = (value) =>
  /^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(
    String(value || "").trim(),
  );

export const clampDrawioZoom = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.min(DRAWIO_ZOOM_MAX, Math.max(DRAWIO_ZOOM_MIN, numeric));
};

export const stepDrawioZoom = (value, direction, step = DRAWIO_ZOOM_STEP) => {
  const delta = Number(direction) < 0 ? -Math.abs(step) : Math.abs(step);
  return clampDrawioZoom(Number(value) + delta);
};
