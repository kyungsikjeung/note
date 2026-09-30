import assert from "node:assert/strict";
import test from "node:test";
import pkg from "../electron/atlassian-rovo-service.cjs";

const { discoverRovoTools, buildToolArgs } = pkg;

const statusFixture = {
  servers: [
    {
      name: "Atlassian Rovo",
      tools: [
        {
          name: "createConfluencePage",
          description: "Create a Confluence page with title and body",
          inputSchema: {
            type: "object",
            properties: {
              cloudId: { type: "string", description: "Atlassian cloud ID" },
              spaceId: { type: "string", description: "Confluence space ID" },
              title: { type: "string", description: "Page title" },
              body: { type: "string", description: "Page body in ADF" },
              parentId: { type: "string", description: "Parent page ID" },
            },
          },
        },
        {
          name: "searchConfluence",
          description: "Search Confluence pages",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
        {
          name: "listConfluenceSpaces",
          description: "List accessible Confluence spaces",
          inputSchema: { type: "object", properties: {} },
        },
      ],
    },
    {
      name: "github",
      tools: [
        {
          name: "createIssue",
          description: "Create a GitHub issue",
          inputSchema: {
            type: "object",
            properties: { title: { type: "string" } },
          },
        },
      ],
    },
  ],
};

test("create-page tool is discovered by description and schema", () => {
  const found = discoverRovoTools(statusFixture);
  assert.equal(found.createPage.tool, "createConfluencePage");
  assert.match(found.createPage.server, /Rovo/);
  assert.equal(found.serverCount, 2);
});

test("dangerous lookalikes never match create", () => {
  const found = discoverRovoTools({
    servers: [
      {
        name: "Atlassian Rovo",
        tools: [
          { name: "deleteConfluencePage", description: "Delete a page", inputSchema: { properties: {} } },
          { name: "updateConfluencePage", description: "Update a page title and body", inputSchema: { properties: { title: {}, body: {} } } },
        ],
      },
    ],
  });
  assert.equal(found.createPage, null);
});

test("explicit override wins over discovery", () => {
  const found = discoverRovoTools(statusFixture, {
    createTool: { server: "custom", tool: "myCreate", score: 99 },
  });
  assert.equal(found.createPage.tool, "myCreate");
});

test("tool args map our fields onto the runtime schema", () => {
  const tool = statusFixture.servers[0].tools[0];
  const { args, unmapped } = buildToolArgs(tool, {
    cloudId: "cloud-1",
    spaceId: "space-9",
    title: "Hello",
    body: { version: 1 },
    parentId: "page-3",
    nonsense: "x",
  });
  assert.deepEqual(args, {
    cloudId: "cloud-1",
    spaceId: "space-9",
    title: "Hello",
    body: { version: 1 },
    parentId: "page-3",
  });
  assert.deepEqual(unmapped, ["nonsense"]);
});
