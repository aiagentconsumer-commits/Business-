import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEvent, createGoogleCalendarBooking } from "../src/calendar.js";
import { buildMetaLeadPayload, recordMetaLead } from "../src/meta.js";
import { buildIntegratedToolResults } from "../src/vapi-handler.js";

test("builds a bounded Google Calendar callback event", () => {
  const event = buildCalendarEvent({
    startTime: "2026-08-22T10:00:00.000Z",
    durationMinutes: 30,
    timeZone: "Asia/Kolkata",
    name: "Avery",
    email: "avery@example.com",
    department: "sales",
  });

  assert.equal(event.summary, "NexusAI callback — sales");
  assert.equal(event.end.dateTime, "2026-08-22T10:30:00.000Z");
  assert.deepEqual(event.attendees, [{ email: "avery@example.com" }]);
});

test("creates a calendar event with a mocked Google token exchange", async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(
      requests.length === 1 ? { access_token: "access-token" } : { id: "event-123", htmlLink: "https://calendar.example/event-123" },
    ), { status: 200, headers: { "content-type": "application/json" } });
  };

  const booking = await createGoogleCalendarBooking(
    { startTime: "2026-08-22T10:00:00.000Z", durationMinutes: 30 },
    { clientId: "id", clientSecret: "secret", refreshToken: "refresh", calendarId: "primary" },
    fetchMock,
  );

  assert.equal(booking.id, "event-123");
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /\/calendars\/primary\/events/);
});

test("hashes Meta contact data before building a Lead event", () => {
  const payload = buildMetaLeadPayload({
    eventId: "lead-1",
    eventTime: "2026-08-22T10:00:00.000Z",
    email: "Avery@Example.com",
    phone: "+1 (555) 123-4567",
    eventSourceUrl: "https://nexus.example/",
  });

  assert.notEqual(payload.data[0].user_data.em[0], "avery@example.com");
  assert.notEqual(payload.data[0].user_data.ph[0], "15551234567");
  assert.equal(payload.data[0].event_name, "Lead");
});

test("submits a Meta Lead event with a mocked API response", async () => {
  const fetchMock = async () => new Response(JSON.stringify({ events_received: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  const result = await recordMetaLead(
    { eventId: "lead-2", eventSourceUrl: "https://nexus.example/" },
    { pixelId: "pixel", accessToken: "token", graphApiVersion: "v25.0" },
    fetchMock,
  );
  assert.deepEqual(result, { eventId: "lead-2", eventsReceived: 1 });
});

test("returns booked and recorded tool results through Vapi tool calls", async () => {
  const results = await buildIntegratedToolResults({
    toolWithToolCallList: [
      { name: "book_callback", toolCall: { id: "calendar-1", parameters: { startTime: "2026-08-22T10:00:00.000Z" } } },
      { name: "record_meta_lead", toolCall: { id: "meta-1", parameters: { eventId: "lead-3" } } },
    ],
  }, { routes: {}, fallback: null }, {}, {
    createBooking: async () => ({ id: "event-1", htmlLink: null }),
    recordLead: async () => ({ eventId: "lead-3", eventsReceived: 1 }),
  });

  assert.deepEqual(JSON.parse(results[0].result), { status: "booked", id: "event-1", htmlLink: null });
  assert.deepEqual(JSON.parse(results[1].result), { status: "recorded", eventId: "lead-3", eventsReceived: 1 });
});

test("books a qualified meeting and records both ad platforms only with consent", async () => {
  const results = await buildIntegratedToolResults({
    toolWithToolCallList: [{
      name: "qualify_and_book_meeting",
      toolCall: {
        id: "qualified-1",
        parameters: {
          consentForAds: true,
          attribution: { googleAds: true, metaAds: true },
          startTime: "2026-08-22T10:00:00.000Z",
        },
      },
    }],
  }, { routes: {}, fallback: null }, {}, {
    createBooking: async () => ({ id: "event-2", htmlLink: null }),
    recordGoogleAds: async () => ({ orderId: "lead-4" }),
    recordLead: async () => ({ eventId: "lead-4", eventsReceived: 1 }),
  });

  assert.deepEqual(JSON.parse(results[0].result), {
    status: "booked",
    booking: { id: "event-2", htmlLink: null },
    attribution: {
      googleAds: { status: "recorded", orderId: "lead-4" },
      metaAds: { status: "recorded", eventId: "lead-4", eventsReceived: 1 },
    },
  });
});
