const sliceText = (value, max) => String(value ?? "").slice(0, max);

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeAttr = (value) => escapeHtml(value).replace(/'/g, "&#39;");

const asArray = (value) => (Array.isArray(value) ? value : []);

const cleanList = (items, max, map) =>
  asArray(items)
    .slice(0, max)
    .map(map)
    .filter((entry) => entry && (entry.name || entry.title || entry.key));

const READ_ONLY_RULE =
  "Read only. Never create, update, or delete external content or local files.";

const JSON_RULE =
  "Respond with ONLY one JSON object (no markdown fences, no explanations).";

export const ROVO_JSON_INSTRUCTION = `${JSON_RULE} ${READ_ONLY_RULE}`;

export const buildRovoStatusInstruction = () =>
  `Atlassian Rovo로 현재 인증 사용자와 접근 가능한 사이트를 읽기 전용으로 확인해줘. ${ROVO_JSON_INSTRUCTION} 형식: {"rovoKind":"status","user":{"displayName":"표시 이름","email":"이메일","accountId":"계정 ID"},"sites":[{"name":"사이트 이름","url":"사이트 URL","cloudId":"cloud ID"}],"jiraProjects":[{"key":"프로젝트 키","name":"프로젝트 이름"}],"confluenceSpaces":[{"key":"스페이스 키","name":"스페이스 이름"}]}. 모르는 값은 빈 문자열이나 빈 배열로 둬. 아무것도 수정하지 마.`;

export const buildRovoPageInstruction = (target = {}) => {
  const source = sliceText(target.source || "", 500);
  const hint = target.pageId
    ? `Confluence 페이지 ID ${sliceText(target.pageId, 64)}`
    : `Confluence 링크 ${source}`;
  const site = target.site ? ` (사이트: ${sliceText(target.site, 200)})` : "";
  return `Atlassian Rovo로 ${hint}${site}를 읽기 전용으로 조회해줘. ${ROVO_JSON_INSTRUCTION} 형식: {"rovoKind":"confluence-page","title":"페이지 제목","space":"스페이스 이름","author":"작성자","updated":"최종 수정 시각","excerpt":"핵심 내용 500자 요약","url":"원본 URL"}. 원본 URL은 ${source || "조회한 페이지 URL"}로 적어. 아무것도 수정하지 마.`;
};

export const buildRovoIssueInstruction = (target = {}) => {
  const key = sliceText(target.issueKey || target.source || "", 64);
  const site = target.site ? ` (사이트: ${sliceText(target.site, 200)})` : "";
  return `Atlassian Rovo로 Jira 이슈 ${key}${site}를 읽기 전용으로 조회해줘. ${ROVO_JSON_INSTRUCTION} 형식: {"rovoKind":"jira-issue","key":"이슈 키","summary":"요약","status":"상태","assignee":"담당자","description":"설명 500자 요약","comments":["최근 댓글 5개以内 요약"],"url":"원본 URL"}. 원본 URL은 ${sliceText(target.source || "", 500) || "조회한 이슈 URL"}로 적어. 아무것도 수정하지 마.`;
};

export const buildRovoSearchInstruction = (query = "") => {
  const text = sliceText(query, 500);
  return `Atlassian Rovo Search로 Jira와 Confluence에서 '${text || "관련 자료"}'를 읽기 전용으로 통합 검색해줘. ${ROVO_JSON_INSTRUCTION} 형식: {"rovoKind":"search","query":"검색어","results":[{"type":"jira 또는 confluence","title":"제목","url":"원본 URL","excerpt":"200자 발췌"}]}. 최대 10개까지. 아무것도 수정하지 마.`;
};

export const parseRovoPayload = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, code: "rovo_empty" };
  const candidate = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return { ok: false, code: "rovo_not_json" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, code: "rovo_not_object" };
  const kind = String(parsed.rovoKind || "");
  if (!["status", "confluence-page", "jira-issue", "search"].includes(kind))
    return { ok: false, code: "rovo_unknown_kind" };
  return { ok: true, kind, data: parsed };
};

export const normalizeRovoStatus = (data = {}) => {
  const user = data.user && typeof data.user === "object" ? data.user : {};
  return {
    kind: "status",
    user: {
      displayName: sliceText(user.displayName, 120),
      email: sliceText(user.email, 160),
      accountId: sliceText(user.accountId, 120),
    },
    sites: cleanList(data.sites, 20, (site) => ({
      name: sliceText(site?.name, 160),
      url: sliceText(site?.url, 300),
      cloudId: sliceText(site?.cloudId, 120),
    })),
    jiraProjects: cleanList(data.jiraProjects, 50, (project) => ({
      key: sliceText(project?.key, 32),
      name: sliceText(project?.name, 160),
    })),
    confluenceSpaces: cleanList(data.confluenceSpaces, 50, (space) => ({
      key: sliceText(space?.key, 64),
      name: sliceText(space?.name, 160),
    })),
  };
};

export const normalizeRovoPage = (data = {}) => ({
  kind: "confluence-page",
  title: sliceText(data.title, 240),
  space: sliceText(data.space, 160),
  author: sliceText(data.author, 120),
  updated: sliceText(data.updated, 120),
  excerpt: sliceText(data.excerpt, 2000),
  url: sliceText(data.url, 500),
});

export const normalizeRovoIssue = (data = {}) => ({
  kind: "jira-issue",
  key: sliceText(data.key, 32),
  summary: sliceText(data.summary, 300),
  status: sliceText(data.status, 80),
  assignee: sliceText(data.assignee, 120),
  description: sliceText(data.description, 2000),
  comments: asArray(data.comments).slice(0, 5).map((item) => sliceText(item, 500)),
  url: sliceText(data.url, 500),
});

export const normalizeRovoSearch = (data = {}) => ({
  kind: "search",
  query: sliceText(data.query, 200),
  results: cleanList(data.results, 10, (item) => ({
    type: sliceText(item?.type, 20),
    title: sliceText(item?.title, 240),
    url: sliceText(item?.url, 500),
    excerpt: sliceText(item?.excerpt, 600),
  })),
});

export const normalizeRovoPayload = (parsed) => {
  if (!parsed?.ok) return null;
  if (parsed.kind === "status") return normalizeRovoStatus(parsed.data);
  if (parsed.kind === "confluence-page") return normalizeRovoPage(parsed.data);
  if (parsed.kind === "jira-issue") return normalizeRovoIssue(parsed.data);
  if (parsed.kind === "search") return normalizeRovoSearch(parsed.data);
  return null;
};

const linkRow = (url) =>
  url && /^https?:/i.test(url)
    ? `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>`
    : escapeHtml(url || "URL 없음");

export const extractCitedSources = (value) => {
  const text = String(value || "");
  const section = text.match(/(?:^|\n)\s*(?:sources?|출처|참고)[:：]?\s*\n([\s\S]*)$/i);
  const scope = section ? section[1] : text;
  const cited = [];
  const seen = new Set();
  for (const match of scope.matchAll(/^(?:\s*(?:[-*]|\d+[.)])\s*)?(?:(\d+)[.)]\s*)?(?:(.{1,200}?)\s*[-–—:：]\s*)?(https?:\/\/[^\s<>"')\]]+)/gim)) {
    const url = match[3];
    if (seen.has(url)) continue;
    seen.add(url);
    cited.push({
      n: match[1] ? Number(match[1]) : cited.length + 1,
      title: (match[2] || "").trim().slice(0, 200),
      url: url.slice(0, 500),
    });
    if (cited.length >= 20) break;
  }
  return cited;
};

export const linkCitationMarkers = (html, cited = []) => {
  const byNumber = new Map();
  for (const entry of cited) {
    if (Number.isFinite(entry?.n) && entry?.url) byNumber.set(entry.n, entry.url);
  }
  if (!byNumber.size) return String(html || "");
  let inAnchor = false;
  return String(html || "")
    .split(/(<[^>]*>)/g)
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<a[\s>]/i.test(part)) inAnchor = true;
        else if (/^<\/a\s*>/i.test(part)) inAnchor = false;
        return part;
      }
      if (inAnchor) return part;
      return part.replace(/\[(\d{1,2})\]/g, (marker, digits) => {
        const url = byNumber.get(Number(digits));
        if (!url) return marker;
        return `<a href="${escapeAttr(url)}">${marker}</a>`;
      });
    })
    .join("");
};

export const rovoToQuoteHtml = (normalized, queriedAt) => {
  const stamp = escapeHtml(queriedAt || "");
  if (!normalized) return "";
  if (normalized.kind === "status") {
    const user = [normalized.user.displayName, normalized.user.email]
      .filter(Boolean)
      .join(" · ");
    const sites = normalized.sites
      .map((site) => `<li>${escapeHtml(site.name || site.url)} — ${linkRow(site.url)}</li>`)
      .join("");
    const projects = normalized.jiraProjects
      .map((project) => `<li>${escapeHtml(project.key)} ${escapeHtml(project.name)}</li>`)
      .join("");
    const spaces = normalized.confluenceSpaces
      .map((space) => `<li>${escapeHtml(space.key)} ${escapeHtml(space.name)}</li>`)
      .join("");
    return `<blockquote><p>Rovo 연결 상태 (${stamp})</p><p>사용자: ${escapeHtml(user || "확인 불가")}</p><p>접근 가능 사이트:</p><ul>${sites || "<li>없음</li>"}</ul><p>Jira 프로젝트:</p><ul>${projects || "<li>없음</li>"}</ul><p>Confluence 공간:</p><ul>${spaces || "<li>없음</li>"}</ul></blockquote>`;
  }
  if (normalized.kind === "confluence-page") {
    return `<blockquote><p>${escapeHtml(normalized.title || "제목 없음")} (${stamp})</p><p>스페이스: ${escapeHtml(normalized.space)} · 작성자: ${escapeHtml(normalized.author)} · 수정: ${escapeHtml(normalized.updated)}</p><p>${escapeHtml(normalized.excerpt)}</p><p>출처: ${linkRow(normalized.url)}</p></blockquote>`;
  }
  if (normalized.kind === "jira-issue") {
    const comments = normalized.comments
      .map((comment) => `<li>${escapeHtml(comment)}</li>`)
      .join("");
    return `<blockquote><p>[${escapeHtml(normalized.key)}] ${escapeHtml(normalized.summary)} (${stamp})</p><p>상태: ${escapeHtml(normalized.status)} · 담당자: ${escapeHtml(normalized.assignee)}</p><p>${escapeHtml(normalized.description)}</p>${comments ? `<p>최근 댓글:</p><ul>${comments}</ul>` : ""}<p>출처: ${linkRow(normalized.url)}</p></blockquote>`;
  }
  if (normalized.kind === "search") {
    const items = normalized.results
      .map(
        (item) =>
          `<li>[${escapeHtml(item.type)}] ${escapeHtml(item.title)} — ${linkRow(item.url)}<br>${escapeHtml(item.excerpt)}</li>`,
      )
      .join("");
    return `<blockquote><p>Rovo 통합 검색: ${escapeHtml(normalized.query)} (${stamp})</p><ul>${items || "<li>결과 없음</li>"}</ul></blockquote>`;
  }
  return "";
};
