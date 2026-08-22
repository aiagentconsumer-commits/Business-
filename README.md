# Business- — AI Agent Call Handoff Starter

This repository contains a minimal Node.js service for routing Vapi AI-agent calls to human teams or another Vapi assistant. It accepts Vapi Server URL events, returns transfer destinations quickly, and provides a `request_handoff` tool-result pattern for use in an assistant prompt.

## Architecture options

| Approach | Trade-offs | Cost | Setup complexity |
|---|---|---:|---|
| **Node.js handoff service (included)** | Supports department-based routing, custom logging, CRM hooks, and future business rules. You operate the public endpoint. | Infrastructure only | Moderate |
| **Static transfer configured in Vapi** | Fastest path when every caller goes to one destination, but does not support dynamic routing or custom lead workflows. | Vapi plan only | Low |

## What the starter handles

- `transfer-destination-request` events by returning a destination for the selected department.
- `assistant-request` events by returning the default handoff destination when immediate routing is needed.
- `tool-calls` events for a `request_handoff` tool, returning structured tool results without exposing any secret.
- Optional Bearer-token verification using Vapi Custom Credentials.
- `/health` for a deployment health check.

> Vapi requires quick responses to assistant-selection requests. Keep any CRM lookup or enrichment asynchronous, and return a preconfigured destination immediately. See the [Vapi Server Events documentation](https://docs.vapi.ai/server-url/events).

## Local setup

```bash
cp .env.example .env
# Edit .env with non-placeholder phone, SIP, or assistant destinations.
npm test
npm start
```

The service uses only Node.js built-ins. Node.js 20 or later is required.

## Configuration

| Variable | Purpose |
|---|---|
| `PORT` | HTTP port; defaults to `3000`. |
| `VAPI_WEBHOOK_TOKEN` | Optional shared bearer token used to validate incoming Vapi Server URL requests. |
| `HANDOFF_DESTINATIONS_JSON` | JSON map of department names to Vapi destinations. |
| `HANDOFF_FALLBACK_DESTINATION` | JSON destination used when no department-specific route matches. |

A destination must be one of the Vapi-supported shapes below:

```json
{ "type": "number", "number": "+15551234567" }
```

```json
{ "type": "sip", "uri": "sip:agent@example.com" }
```

```json
{ "type": "assistant", "assistantId": "assistant-uuid" }
```

## Vapi configuration

1. Deploy this service to a public HTTPS URL and configure the assistant Server URL as `https://your-domain.example/vapi/server-events`.
2. In Vapi Dashboard, create a **Custom Credential** using a Bearer token. Set the same value as `VAPI_WEBHOOK_TOKEN` and reference its `credentialId` in the assistant server configuration.
3. Add a Vapi function tool named `request_handoff`. Its parameters should include a `department` string, such as `sales`, `support`, or `default`.
4. Add the same keys to `HANDOFF_DESTINATIONS_JSON`. The webhook resolves the request and returns a Vapi-compatible tool result; Vapi can then request a transfer destination.

Vapi’s current server authentication model uses reusable custom credentials, including Bearer tokens, associated with a `credentialId`. See the [official authentication guide](https://docs.vapi.ai/server-url/server-authentication).

## Example event flow

```text
Caller asks for sales support
        ↓
Assistant invokes request_handoff({ department: "sales" })
        ↓
POST /vapi/server-events receives tool-calls
        ↓
Service returns routing result, then Vapi requests a transfer destination
        ↓
Service returns the configured sales destination
```

## Safety notes

Do not commit `.env`, phone numbers, API keys, credentials, call recordings, or transcripts. The starter logs only the event type and does not persist caller data. Add an approved CRM or ticketing integration only after defining retention, consent, and access policies.

## Scripts

| Command | Purpose |
|---|---|
| `npm start` | Run the HTTP handoff service. |
| `npm test` | Run deterministic routing and response tests. |
