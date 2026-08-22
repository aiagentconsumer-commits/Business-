const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";

function configured(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function validStartTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("startTime must be an ISO 8601 date-time.");
  }
  return date;
}

function safeDuration(value) {
  const duration = Number(value ?? 30);
  if (!Number.isInteger(duration) || duration < 15 || duration > 240) {
    throw new Error("durationMinutes must be an integer between 15 and 240.");
  }
  return duration;
}

export function loadCalendarSettings(env = process.env) {
  return {
    clientId: configured(env.GOOGLE_CLIENT_ID),
    clientSecret: configured(env.GOOGLE_CLIENT_SECRET),
    refreshToken: configured(env.GOOGLE_REFRESH_TOKEN),
    calendarId: configured(env.GOOGLE_CALENDAR_ID),
  };
}

export function calendarConfigured(settings) {
  return Boolean(settings.clientId && settings.clientSecret && settings.refreshToken && settings.calendarId);
}

export function buildCalendarEvent(booking) {
  const start = validStartTime(booking?.startTime);
  const duration = safeDuration(booking?.durationMinutes);
  const end = new Date(start.getTime() + duration * 60_000);
  const department = configured(booking?.department) || "general";
  const callerName = configured(booking?.name) || "Caller";
  const timeZone = configured(booking?.timeZone) || "UTC";
  const email = configured(booking?.email);

  return {
    summary: `NexusAI callback — ${department}`,
    description: [
      "Scheduled through the NexusAI Vapi handoff service.",
      `Caller: ${callerName}`,
      `Department: ${department}`,
    ].join("\n"),
    start: { dateTime: start.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
    ...(email ? { attendees: [{ email }] } : {}),
  };
}

async function getAccessToken(settings, fetchImpl) {
  const body = new URLSearchParams({
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
    refresh_token: settings.refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error("Google OAuth token refresh failed.");
  }
  return payload.access_token;
}

export async function createGoogleCalendarBooking(booking, settings, fetchImpl = fetch) {
  if (!calendarConfigured(settings)) {
    throw new Error("Google Calendar integration is not configured.");
  }

  const accessToken = await getAccessToken(settings, fetchImpl);
  const event = buildCalendarEvent(booking);
  const response = await fetchImpl(
    `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(settings.calendarId)}/events?sendUpdates=all`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );
  const payload = await response.json();
  if (!response.ok || !payload.id) {
    throw new Error("Google Calendar event creation failed.");
  }

  return { id: payload.id, htmlLink: payload.htmlLink ?? null };
}
