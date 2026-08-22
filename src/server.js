import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import { loadHandoffConfig } from "./handoff.js";
import { buildIntegratedServerEventResponse } from "./vapi-handler.js";
import { loadCalendarSettings } from "./calendar.js";
import { loadMetaSettings } from "./meta.js";

const MAX_BODY_BYTES = 1_000_000;

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function authorized(request, token) {
  if (!token) return true;

  const provided = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds 1 MB limit.");
    }
  }

  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export function createHandoffServer(env = process.env) {
  const config = loadHandoffConfig(env);
  const webhookToken = env.VAPI_WEBHOOK_TOKEN;
  const integrationSettings = {
    calendar: loadCalendarSettings(env),
    meta: loadMetaSettings(env),
  };

  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      return writeJson(response, 200, { ok: true, routes: Object.keys(config.routes) });
    }

    if (request.method !== "POST" || request.url !== "/vapi/server-events") {
      return writeJson(response, 404, { error: "Not found" });
    }

    if (!authorized(request, webhookToken)) {
      return writeJson(response, 401, { error: "Unauthorized" });
    }

    try {
      const event = await readJson(request);
      const message = event?.message ?? {};
      const outcome = await buildIntegratedServerEventResponse(message, config, integrationSettings);

      // Do not log call audio, transcripts, phone numbers, or raw payloads.
      console.info(`[vapi] event=${message.type ?? "unknown"} status=${outcome.statusCode}`);
      return writeJson(response, outcome.statusCode, outcome.body);
    } catch (error) {
      return writeJson(response, 400, {
        error: error instanceof Error ? error.message : "Invalid request",
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  const server = createHandoffServer();
  server.listen(port, () => console.info(`Handoff service listening on port ${port}`));
}
