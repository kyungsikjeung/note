import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreatePageArgs,
  checkAdfDocument,
  classifyPublishError,
  findConfluenceCreateTool,
  findRovoServer,
  findSpaceListTool,
  listServerTools,
  publicationIdempotencyKey,
  rovoReadiness,
} from "../electron/atlassian-rovo-service.cjs";

const createTool = {
  name: "createConfluencePage",
  title: "Create Page",
  description: "Create a new Confluence page in a space",
  inputSchema: {
    type: "object",
    properties: {
      cloudId: { type: "string" },
      spaceId: { type: "string" },
      title: { type: "string" },
      body: { type: "object" },
      contentFormat: { type: "string", enum: ["markdown", "adf"] },
      parentId: { type: "string" },
    },
    required: ["cloudId", "spaceId", "title", "body"],
  },
  annotations: { readOnlyHint: false },
};

const updateTool = {
  name: "updateConfluencePage",
  title: "Update Page",
  description: "Update an existing Confluence page",
  inputSchema: {
    type: "object",
    properties: { pageId: { type: "string" }, body: { type: "object" } },
    required: ["pageId", "body"],
  },
  annotations: { readOnlyHint: false },
};

const searchTool = {
  name: "searchConfluence",
  title: "Search",
  description: "Search Confluence content",
  inputSchema: { type: "object", properties: { query: { type: "string" } } },
  annotations: { readOnlyHint: true },
};

test("rovo server is found without hardcoding its name", () => {
  const server = findRovoServer({
    data: [{ name: "other" }, { name: "atlassian", authStatus: "bearerToken", tools: {} }],
  });
  assert.equal(server.name, "atlassian");
  assert.equal(findRovoServer({ data: [] }), null);
  assert.equal(findRovoServer(null), null);
});

test("readiness separates oauth from missing setup", () => {
  assert.equal(rovoReadiness(null).code, "rovo_not_configured");
  assert.equal(
    rovoReadiness({ authStatus: "notLoggedIn", toolsError: "OAuth authorization required" }).code,
    "rovo_oauth_required",
  );
  assert.equal(rovoReadiness({ authStatus: "bearerToken", tools: {} }).ok, true);
});

test("create-page tool wins over update and search tools", () => {
  const tools = listServerTools({
    tools: { updateConfluencePage: updateTool, searchConfluence: searchTool, createConfluencePage: createTool },
  });
  assert.equal(tools.length, 3);
  const found = findConfluenceCreateTool(tools);
  assert.equal(found.tool.name, "createConfluencePage");
  assert.ok(found.score > 0);
  assert.equal(findConfluenceCreateTool([updateTool, searchTool]), null);
});

test("arg builder maps canonical fields onto schema properties", () => {
  const adf = { version: 1, type: "doc", content: [] };
  const built = buildCreatePageArgs(createTool, {
    cloudId: "c1",
    spaceId: "S",
    title: "T",
    body: adf,
    bodyFormat: "adf",
  });
  assert.equal(built.ok, true);
  assert.deepEqual(built.args, {
    cloudId: "c1",
    spaceId: "S",
    title: "T",
    body: adf,
    contentFormat: "adf",
  });
  const missing = buildCreatePageArgs(createTool, { cloudId: "c1" });
  assert.equal(missing.ok, false);
  assert.ok(missing.missing.includes("spaceId"));
  assert.ok(missing.missing.includes("title"));
});

test("errors classify into distinct publish codes", () => {
  assert.equal(classifyPublishError("OAuth authorization required").code, "rovo_oauth_required");
  assert.equal(classifyPublishError("Unknown MCP server 'x'").code, "rovo_not_configured");
  assert.equal(classifyPublishError("403 forbidden").code, "rovo_permission_denied");
  assert.equal(classifyPublishError("page does not exist 404").code, "rovo_not_found");
  assert.equal(classifyPublishError("abort by user").code, "publish_declined");
  assert.equal(classifyPublishError("request timed out").code, "publish_timeout");
  assert.equal(classifyPublishError("transport closed").code, "app_server_unavailable");
  assert.equal(classifyPublishError("weird new failure").code, "publish_failed");
});

test("adf structural check guards tables and shapes", () => {
  assert.equal(checkAdfDocument({ version: 1, type: "doc", content: [] }).ok, true);
  assert.equal(checkAdfDocument(null).ok, false);
  assert.equal(
    checkAdfDocument({ version: 1, type: "doc", content: [{ type: "table", attrs: { width: 50 }, content: [] }] }).issues[0].code,
    "adf_table_width_invalid",
  );
  assert.equal(
    publicationIdempotencyKey({ noteId: "n", sourceRevision: "r1", contentHash: "h" }),
    "n|r1|h",
  );
});

test("space list tool is discoverable when present", () => {
  const spaceTool = {
    name: "listConfluenceSpaces",
    description: "List Confluence spaces",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  };
  assert.equal(findSpaceListTool([spaceTool, createTool]).tool.name, "listConfluenceSpaces");
  assert.equal(findSpaceListTool([createTool]), null);
});
