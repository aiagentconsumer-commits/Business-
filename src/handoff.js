const DESTINATION_REQUIREMENTS = {
  number: "number",
  sip: "uri",
  assistant: "assistantId",
};

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizedKey(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "default";
}

export function normalizeDestination(destination) {
  if (!destination || typeof destination !== "object") return null;

  const type = typeof destination.type === "string"
    ? destination.type.trim().toLowerCase()
    : "";
  const requiredField = DESTINATION_REQUIREMENTS[type];

  if (!requiredField) return null;

  const value = destination[requiredField];
  if (typeof value !== "string" || !value.trim()) return null;

  return { type, [requiredField]: value.trim() };
}

export function loadHandoffConfig(env = process.env) {
  const rawRoutes = parseJson(env.HANDOFF_DESTINATIONS_JSON, {});
  const routes = Object.fromEntries(
    Object.entries(rawRoutes).flatMap(([key, destination]) => {
      const normalized = normalizeDestination(destination);
      return normalized ? [[normalizedKey(key), normalized]] : [];
    }),
  );

  return {
    routes,
    fallback: normalizeDestination(parseJson(env.HANDOFF_FALLBACK_DESTINATION, null)),
  };
}

export function resolveDestination(department, config) {
  const route = config.routes[normalizedKey(department)]
    ?? config.routes.default
    ?? config.fallback;

  return route ?? null;
}

function toolParameters(toolCall) {
  const parameters = toolCall?.parameters;
  if (parameters && typeof parameters === "object") return parameters;
  if (typeof parameters === "string") return parseJson(parameters, {});
  return {};
}

export function buildToolResults(message, config) {
  const toolCalls = Array.isArray(message?.toolWithToolCallList)
    ? message.toolWithToolCallList
    : [];

  return toolCalls.flatMap(({ name, toolCall }) => {
    if (name !== "request_handoff" || !toolCall?.id) return [];

    const parameters = toolParameters(toolCall);
    const department = normalizedKey(parameters.department);
    const destination = resolveDestination(department, config);
    const result = destination
      ? { status: "ready", department, destination }
      : { status: "unavailable", department, reason: "No eligible handoff destination is configured." };

    return [{
      name,
      toolCallId: toolCall.id,
      result: JSON.stringify(result),
    }];
  });
}

function requestedDepartment(message) {
  return message?.call?.metadata?.department
    ?? message?.call?.metadata?.handoffDepartment
    ?? "default";
}

export function buildServerEventResponse(message, config) {
  const type = message?.type;

  if (type === "tool-calls") {
    return { statusCode: 200, body: { results: buildToolResults(message, config) } };
  }

  if (type === "assistant-request" || type === "transfer-destination-request") {
    const destination = resolveDestination(requestedDepartment(message), config);
    if (!destination) {
      return {
        statusCode: 503,
        body: { error: "No eligible handoff destination is configured." },
      };
    }

    return {
      statusCode: 200,
      body: {
        destination,
        message: {
          type: "request-start",
          message: "Connecting you with the appropriate team now.",
        },
      },
    };
  }

  return { statusCode: 200, body: { received: true, eventType: type ?? "unknown" } };
}
