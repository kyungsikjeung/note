const readline = require("readline");

const withApproval = process.argv.includes("--with-approval");
const log = { statusParams: null, toolCalls: [], approvalResponse: null };
let pendingToolCall = null;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

const reader = readline.createInterface({ input: process.stdin });
reader.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method && message.id === undefined) return;
  if (message.method === "initialized") return;
  if (message.mock === true || message.method === "mock/getLog") {
    send({ id: message.id, result: log });
    return;
  }
  switch (message.method) {
    case "mock/wait":
      break;
    case "initialize":
      send({ id: message.id, result: { ok: true } });
      break;
    case "thread/start":
      send({ id: message.id, result: { thread: { id: "thread_mock1" } } });
      break;
    case "thread/archive":
      send({ id: message.id, result: {} });
      break;
    case "mcpServerStatus/list":
      log.statusParams = message.params;
      send({
        id: message.id,
        result: {
          data: [
            {
              name: "atlassian",
              authStatus: "bearerToken",
              tools: {
                createConfluencePage: {
                  name: "createConfluencePage",
                  description: "Create a new Confluence page in a space",
                  inputSchema: {
                    type: "object",
                    properties: {
                      cloudId: { type: "string" },
                      spaceId: { type: "string" },
                      title: { type: "string" },
                      body: { type: "object" },
                    },
                    required: ["cloudId", "spaceId", "title", "body"],
                  },
                  annotations: { readOnlyHint: false },
                },
              },
            },
          ],
        },
      });
      break;
    case "mcpServer/tool/call": {
      log.toolCalls.push(message.params);
      const respond = () =>
        send({
          id: message.id,
          result: { pageId: "987", url: "https://example.atlassian.net/wiki/987" },
        });
      if (!withApproval) {
        respond();
        break;
      }
      pendingToolCall = { id: message.id, respond };
      send({
        id: 501,
        method: "item/commandExecution/requestApproval",
        params: { command: ["confluence", "create"], reason: "mock approval" },
      });
      break;
    }
    default:
      if (
        message.id !== undefined &&
        pendingToolCall &&
        message.id === 501
      ) {
        log.approvalResponse = message.result || message.error;
        const pending = pendingToolCall;
        pendingToolCall = null;
        pending.respond();
        break;
      }
      if (message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: "mock: unknown" } });
      }
      break;
  }
});
