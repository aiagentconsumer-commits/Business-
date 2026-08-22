import { createGoogleCalendarBooking, loadCalendarSettings } from "./calendar.js";
import { buildServerEventResponse, buildToolResults } from "./handoff.js";
import { loadMetaSettings, recordMetaLead } from "./meta.js";

function parameters(toolCall) {
  if (toolCall?.parameters && typeof toolCall.parameters === "object") return toolCall.parameters;
  if (typeof toolCall?.parameters !== "string") return {};
  try {
    return JSON.parse(toolCall.parameters);
  } catch {
    return {};
  }
}

function toolResult(name, toolCallId, result) {
  return { name, toolCallId, result: JSON.stringify(result) };
}

export async function buildIntegratedToolResults(message, handoffConfig, settings, adapters = {}) {
  const calendarSettings = settings?.calendar ?? loadCalendarSettings();
  const metaSettings = settings?.meta ?? loadMetaSettings();
  const createBooking = adapters.createBooking ?? createGoogleCalendarBooking;
  const recordLead = adapters.recordLead ?? recordMetaLead;
  const results = buildToolResults(message, handoffConfig);
  const toolCalls = Array.isArray(message?.toolWithToolCallList) ? message.toolWithToolCallList : [];

  for (const { name, toolCall } of toolCalls) {
    if (!toolCall?.id) continue;
    const input = parameters(toolCall);

    try {
      if (name === "book_callback") {
        const booking = await createBooking(input, calendarSettings);
        results.push(toolResult(name, toolCall.id, { status: "booked", ...booking }));
      }

      if (name === "record_meta_lead") {
        const lead = await recordLead(input, metaSettings);
        results.push(toolResult(name, toolCall.id, { status: "recorded", ...lead }));
      }
    } catch (error) {
      results.push(toolResult(name, toolCall.id, {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "Integration request failed.",
      }));
    }
  }

  return results;
}

export async function buildIntegratedServerEventResponse(message, handoffConfig, settings, adapters) {
  if (message?.type !== "tool-calls") {
    return buildServerEventResponse(message, handoffConfig);
  }

  return {
    statusCode: 200,
    body: { results: await buildIntegratedToolResults(message, handoffConfig, settings, adapters) },
  };
}
