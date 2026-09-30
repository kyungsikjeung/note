const ROVO_SERVER_PATTERN = /atlassian|rovo/i;

const REVIEW_DECISION_METHODS = new Set([
  "execCommandApproval",
  "applyPatchApproval",
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
]);

const textOf = (value) => String(value ?? "").toLowerCase();

const hasToken = (value, token) => textOf(value).includes(token);

const toolText = (tool) =>
  `${tool?.name || ""} ${tool?.title || ""} ${tool?.description || ""}`;

const schemaProperties = (tool) => {
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return {};
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties))
    return {};
  return properties;
};

const requiredOf = (tool) => {
  const required = tool?.inputSchema?.required;
  return Array.isArray(required) ? required.filter((item) => typeof item === "string") : [];
};

const pickProperty = (properties, aliases) => {
  const names = Object.keys(properties);
  const lowered = new Map(names.map((name) => [name.toLowerCase(), name]));
  for (const alias of aliases) {
    if (lowered.has(alias)) return lowered.get(alias);
  }
  return null;
};

const findRovoServer = (statusResult) => {
  const servers =
    statusResult?.data || statusResult?.servers || statusResult || [];
  if (!Array.isArray(servers)) return null;
  return (
    servers.find((item) =>
      ROVO_SERVER_PATTERN.test(`${item?.name || ""} ${item?.serverName || ""}`),
    ) || null
  );
};

const rovoReadiness = (server) => {
  if (!server) return { ok: false, code: "rovo_not_configured" };
  const auth = String(server.authStatus || "").toLowerCase();
  if (server.toolsError || auth === "notloggedin" || auth === "not_logged_in")
    return { ok: false, code: "rovo_oauth_required", detail: server.toolsError || "" };
  return { ok: true };
};

const listServerTools = (server) => {
  const tools = server?.tools;
  if (Array.isArray(tools))
    return tools.filter(
      (tool) => tool && typeof tool === "object" && typeof tool.name === "string",
    );
  if (!tools || typeof tools !== "object") return [];
  return Object.values(tools).filter(
    (tool) => tool && typeof tool === "object" && typeof tool.name === "string",
  );
};

const scoreCreatePageTool = (tool) => {
  const text = toolText(tool);
  const readOnly = tool?.annotations?.readOnlyHint === true;
  let score = 0;
  if (hasToken(tool?.name, "creat")) score += 3;
  if (hasToken(tool?.name, "confluence")) score += 2;
  if (hasToken(tool?.name, "page")) score += 2;
  if (hasToken(text, "confluence") && hasToken(text, "creat")) score += 2;
  if (hasToken(tool?.description, "page")) score += 1;
  const required = requiredOf(tool).map((item) => item.toLowerCase());
  const wantsTitle = required.some((item) => item.includes("title"));
  const wantsSpace = required.some((item) => item.includes("space"));
  const wantsBody = required.some((item) =>
    ["body", "content", "adf", "document", "value"].some((token) => item.includes(token)),
  );
  if (wantsTitle && wantsSpace && wantsBody) score += 2;
  if (hasToken(text, "updat") && !hasToken(text, "creat")) score -= 8;
  if (hasToken(text, "delet")) score -= 10;
  if (readOnly) score -= 10;
  return score;
};

const findConfluenceCreateTool = (tools) => {
  const candidates = (Array.isArray(tools) ? tools : [])
    .map((tool) => ({ tool, score: scoreCreatePageTool(tool) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  return candidates[0];
};

const scoreSpaceListTool = (tool) => {
  const text = toolText(tool);
  let score = 0;
  if (hasToken(text, "space")) score += 3;
  if (
    hasToken(tool?.name, "list") ||
    hasToken(tool?.name, "search") ||
    hasToken(tool?.name, "get")
  )
    score += 2;
  if (hasToken(tool?.description, "confluence")) score += 1;
  if (tool?.annotations?.readOnlyHint === true) score += 1;
  if (hasToken(text, "creat") || hasToken(text, "updat") || hasToken(text, "delet"))
    score -= 8;
  return score;
};

const findSpaceListTool = (tools) => {
  const candidates = (Array.isArray(tools) ? tools : [])
    .map((tool) => ({ tool, score: scoreSpaceListTool(tool) }))
    .filter((entry) => entry.score >= 3)
    .sort((left, right) => right.score - left.score);
  if (!candidates.length) return null;
  return candidates[0];
};

const FIELD_ALIASES = {
  cloudId: ["cloudid", "cloud_id"],
  spaceId: ["spaceid", "space_id", "spacekey", "space_key"],
  title: ["title", "page_title", "pagetitle", "name"],
  body: ["body", "content", "adf", "document", "pagebody", "page_body", "value"],
  bodyFormat: ["contentformat", "content_format", "format", "representation", "bodyformat", "body_format"],
  parentId: ["parentid", "parent_id", "parentpageid", "parent_page_id", "ancestorid", "ancestor_id"],
};

const discoverRovoTools = (statusResult, overrides = {}) => {
  const servers =
    statusResult?.data || statusResult?.servers || statusResult || [];
  const list = Array.isArray(servers) ? servers : [];
  const rovo = findRovoServer(statusResult);
  const tools = listServerTools(rovo);
  const spaceList = findSpaceListTool(tools);
  const discovered = findConfluenceCreateTool(tools);
  const override = overrides?.createTool;
  const createPage = override
    ? { tool: override.tool, server: override.server, score: override.score ?? 99 }
    : discovered
      ? { tool: discovered.tool.name, server: rovo?.name || "", score: discovered.score }
      : null;
  return {
    server: rovo?.name || "",
    serverCount: list.length,
    toolCount: tools.length,
    createPage,
    spaceList: spaceList
      ? { tool: spaceList.tool.name, server: rovo?.name || "", score: spaceList.score }
      : null,
  };
};

const buildToolArgs = (tool, values = {}) => {
  const properties = schemaProperties(tool);
  const names = Object.keys(properties);
  const lowered = new Map(names.map((name) => [name.toLowerCase(), name]));
  const args = {};
  const unmapped = [];
  for (const [key, value] of Object.entries(values || {})) {
    const property = lowered.get(String(key).toLowerCase());
    if (property) args[property] = value;
    else unmapped.push(key);
  }
  return { args, unmapped };
};

const buildCreatePageArgs = (tool, values = {}) => {
  const properties = schemaProperties(tool);
  const names = Object.keys(properties);
  if (!names.length) {
    return { ok: false, args: {}, missing: ["inputSchema"], warnings: [] };
  }
  const mapped = {};
  const unmapped = [];
  const fieldFor = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const property = pickProperty(properties, aliases);
    if (property) {
      mapped[property] = values[field];
      fieldFor[field] = property;
    } else if (field !== "parentId" && field !== "bodyFormat") {
      unmapped.push(field);
    }
  }
  const warnings = [];
  if (fieldFor.bodyFormat && values.bodyFormat) {
    const allowed = properties[fieldFor.bodyFormat]?.enum;
    if (Array.isArray(allowed) && !allowed.includes(values.bodyFormat)) {
      warnings.push({
        code: "body_format_unsupported",
        message: `도구가 contentFormat ${allowed.join("/")}만 허용합니다.`,
      });
    }
  }
  const missing = [];
  for (const required of requiredOf(tool)) {
    if (mapped[required] === undefined || mapped[required] === null || mapped[required] === "") {
      const known = Object.entries(fieldFor).find(([, property]) => property === required);
      missing.push(known ? known[0] : required);
    }
  }
  for (const field of unmapped) {
    if (!missing.includes(field)) missing.push(field);
  }
  const args = {};
  for (const [property, value] of Object.entries(mapped)) {
    if (value !== undefined) args[property] = value;
  }
  if (missing.length) return { ok: false, args, missing, warnings };
  return { ok: true, args, missing: [], warnings };
};

const classifyPublishError = (raw) => {
  const message = String(raw?.message || raw || "");
  const text = message.toLowerCase();
  if (/oauth|authorization required|reauthor|notloggedin|not_logged_in|not logged in|authorization server issuer|login/i.test(text))
    return { code: "rovo_oauth_required", message };
  if (/unknown mcp server|no such mcp|not configured|not set up|mcp startup failed|environment variable/i.test(text))
    return { code: "rovo_not_configured", message };
  if (/forbidden|permission denied|insufficient|access denied|status.?403|unauthorized_client/i.test(text))
    return { code: "rovo_permission_denied", message };
  if (/not found|status.?404|does not exist|no such/i.test(text))
    return { code: "rovo_not_found", message };
  if (/invalid thread|thread.+fail|turn.+fail/i.test(text))
    return { code: "publish_thread_failed", message };
  if (/abort|user.*declin|declined|denied|rejection|cancel/i.test(text))
    return { code: "publish_declined", message };
  if (/timed? ?out/i.test(text)) return { code: "publish_timeout", message };
  if (/terminat|closed|econn|not connected|exit|kill/i.test(text))
    return { code: "app_server_unavailable", message };
  return { code: "publish_failed", message };
};

const ADF_TABLE_MIN_WIDTH = 144;
const ADF_TABLE_MAX_WIDTH = 1800;

const checkAdfNode = (node, issues) => {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    issues.push({ code: "adf_node_invalid", message: "ADF 노드가 객체가 아닙니다." });
    return;
  }
  if (typeof node.type !== "string" || !node.type) {
    issues.push({ code: "adf_node_type_invalid", message: "ADF 노드 type이 없습니다." });
    return;
  }
  if (node.type === "text" && typeof node.text !== "string") {
    issues.push({ code: "adf_text_invalid", message: "text 노드에 문자열이 없습니다." });
  }
  if (node.type === "table") {
    const width = node.attrs?.width;
    if (typeof width === "number" && (width < ADF_TABLE_MIN_WIDTH || width > ADF_TABLE_MAX_WIDTH)) {
      issues.push({
        code: "adf_table_width_invalid",
        message: `표 너비 ${width}px가 허용 범위(${ADF_TABLE_MIN_WIDTH}~${ADF_TABLE_MAX_WIDTH})를 벗어났습니다.`,
      });
    }
  }
  const children = Array.isArray(node.content) ? node.content : [];
  for (const child of children) checkAdfNode(child, issues);
};

const checkAdfDocument = (document) => {
  const issues = [];
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, issues: [{ code: "adf_document_invalid", message: "ADF 문서가 객체가 아닙니다." }] };
  }
  if (document.version !== 1 || document.type !== "doc" || !Array.isArray(document.content)) {
    return { ok: false, issues: [{ code: "adf_document_invalid", message: "ADF 문서는 {version:1,type:'doc',content:[]} 형태여야 합니다." }] };
  }
  for (const node of document.content) checkAdfNode(node, issues);
  return { ok: issues.length === 0, issues };
};

const publicationIdempotencyKey = ({ noteId, sourceRevision, contentHash }) =>
  [String(noteId || ""), String(sourceRevision || ""), String(contentHash || "")].join("|");

const isReviewDecisionMethod = (method) => REVIEW_DECISION_METHODS.has(method);

module.exports = {
  ROVO_SERVER_PATTERN,
  REVIEW_DECISION_METHODS,
  findRovoServer,
  rovoReadiness,
  listServerTools,
  scoreCreatePageTool,
  findConfluenceCreateTool,
  scoreSpaceListTool,
  findSpaceListTool,
  buildCreatePageArgs,
  discoverRovoTools,
  buildToolArgs,
  classifyPublishError,
  checkAdfDocument,
  publicationIdempotencyKey,
  isReviewDecisionMethod,
};
