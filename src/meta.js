import { createHash, randomUUID } from "node:crypto";

function configured(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEmail(email) {
  return configured(email).toLowerCase();
}

function normalizedPhone(phone) {
  return configured(phone).replace(/[^0-9]/g, "");
}

function eventTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("eventTime must be a valid date-time.");
  return Math.floor(date.getTime() / 1000);
}

export function loadMetaSettings(env = process.env) {
  return {
    pixelId: configured(env.META_PIXEL_ID),
    accessToken: configured(env.META_ACCESS_TOKEN),
    graphApiVersion: configured(env.META_GRAPH_API_VERSION) || "v25.0",
  };
}

export function metaConfigured(settings) {
  return Boolean(settings.pixelId && settings.accessToken);
}

export function buildMetaLeadPayload(lead) {
  const email = normalizedEmail(lead?.email);
  const phone = normalizedPhone(lead?.phone);
  const userData = {
    ...(email ? { em: [sha256(email)] } : {}),
    ...(phone ? { ph: [sha256(phone)] } : {}),
    ...(configured(lead?.clientIpAddress) ? { client_ip_address: configured(lead.clientIpAddress) } : {}),
    ...(configured(lead?.clientUserAgent) ? { client_user_agent: configured(lead.clientUserAgent) } : {}),
    ...(configured(lead?.fbc) ? { fbc: configured(lead.fbc) } : {}),
    ...(configured(lead?.fbp) ? { fbp: configured(lead.fbp) } : {}),
  };

  return {
    data: [{
      event_name: "Lead",
      event_time: eventTime(lead?.eventTime),
      event_id: configured(lead?.eventId) || randomUUID(),
      action_source: "website",
      event_source_url: configured(lead?.eventSourceUrl) || "https://example.invalid/vapi-handoff",
      user_data: userData,
      custom_data: {
        content_name: "AI agent call handoff",
        department: configured(lead?.department) || "general",
      },
    }],
  };
}

export async function recordMetaLead(lead, settings, fetchImpl = fetch) {
  if (!metaConfigured(settings)) {
    throw new Error("Meta Ads integration is not configured.");
  }

  const payload = buildMetaLeadPayload(lead);
  const endpoint = `https://graph.facebook.com/${settings.graphApiVersion}/${settings.pixelId}/events`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...payload, access_token: settings.accessToken }),
  });
  const result = await response.json();
  if (!response.ok || result.events_received !== 1) {
    throw new Error("Meta Lead event submission failed.");
  }

  return { eventId: payload.data[0].event_id, eventsReceived: result.events_received };
}
