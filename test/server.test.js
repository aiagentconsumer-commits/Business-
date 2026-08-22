import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createHandoffServer } from "../src/server.js";

async function withServer(env, run) {
  const server = createHandoffServer(env);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("exposes health and requires the configured Vapi bearer credential", async () => {
  await withServer({
    VAPI_WEBHOOK_TOKEN: "handoff-secret",
    HANDOFF_DESTINATIONS_JSON: JSON.stringify({ sales: { type: "number", number: "+15551234567" } }),
  }, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);

    const rejected = await fetch(`${baseUrl}/vapi/server-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { type: "transfer-destination-request" } }),
    });
    assert.equal(rejected.status, 401);

    const accepted = await fetch(`${baseUrl}/vapi/server-events`, {
      method: "POST",
      headers: {
        authorization: "Bearer handoff-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          type: "transfer-destination-request",
          call: { metadata: { department: "sales" } },
        },
      }),
    });
    assert.equal(accepted.status, 200);
    assert.deepEqual((await accepted.json()).destination, {
      type: "number",
      number: "+15551234567",
    });
  });
});

test("returns a Vapi-safe unavailable result when Calendar credentials are absent", async () => {
  await withServer({ VAPI_WEBHOOK_TOKEN: "handoff-secret" }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/vapi/server-events`, {
      method: "POST",
      headers: {
        authorization: "Bearer handoff-secret",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          toolWithToolCallList: [{
            name: "book_callback",
            toolCall: { id: "calendar-1", parameters: { startTime: "2026-08-22T10:00:00.000Z" } },
          }],
        },
      }),
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(JSON.parse(payload.results[0].result), {
      status: "unavailable",
      reason: "Google Calendar integration is not configured.",
    });
  });
});
