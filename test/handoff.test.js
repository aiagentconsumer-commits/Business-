import assert from "node:assert/strict";
import test from "node:test";
import {
  buildServerEventResponse,
  buildToolResults,
  loadHandoffConfig,
  resolveDestination,
} from "../src/handoff.js";

const config = loadHandoffConfig({
  HANDOFF_DESTINATIONS_JSON: JSON.stringify({
    sales: { type: "number", number: "+15551234567" },
    support: { type: "assistant", assistantId: "assistant-support" },
  }),
  HANDOFF_FALLBACK_DESTINATION: JSON.stringify({ type: "sip", uri: "sip:fallback@example.com" }),
});

test("resolves a department-specific destination", () => {
  assert.deepEqual(resolveDestination("SALES", config), {
    type: "number",
    number: "+15551234567",
  });
});

test("uses the fallback destination for an unmatched department", () => {
  assert.deepEqual(resolveDestination("billing", config), {
    type: "sip",
    uri: "sip:fallback@example.com",
  });
});

test("returns a Vapi-compatible request_handoff tool result", () => {
  const results = buildToolResults({
    toolWithToolCallList: [{
      name: "request_handoff",
      toolCall: { id: "tool-1", parameters: { department: "support" } },
    }],
  }, config);

  assert.equal(results.length, 1);
  assert.equal(results[0].toolCallId, "tool-1");
  assert.deepEqual(JSON.parse(results[0].result), {
    status: "ready",
    department: "support",
    destination: { type: "assistant", assistantId: "assistant-support" },
  });
});

test("returns a transfer destination for Vapi transfer requests", () => {
  const outcome = buildServerEventResponse({
    type: "transfer-destination-request",
    call: { metadata: { department: "sales" } },
  }, config);

  assert.equal(outcome.statusCode, 200);
  assert.deepEqual(outcome.body.destination, {
    type: "number",
    number: "+15551234567",
  });
});
