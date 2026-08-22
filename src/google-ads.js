import { createHash, randomUUID } from "node:crypto";

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_ADS_API = "https://googleads.googleapis.com";

function configured(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedEmail(value) {
  return configured(value).toLowerCase();
}

function normalizedPhone(value) {
  return configured(value).replace(/[^0-9]/g, "");
}

function utcConversionDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error("eventTime must be a valid date-time.");
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}+00:00`;
}

export function loadGoogleAdsSettings(env = process.env) {
  return {
    developerToken: configured(env.GOOGLE_ADS_DEVELOPER_TOKEN),
    clientId: configured(env.GOOGLE_ADS_CLIENT_ID),
    clientSecret: configured(env.GOOGLE_ADS_CLIENT_SECRET),
    refreshToken: configured(env.GOOGLE_ADS_REFRESH_TOKEN),
    customerId: configured(env.GOOGLE_ADS_CUSTOMER_ID).replace(/-/g, ""),
    loginCustomerId: configured(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID).replace(/-/g, ""),
    conversionActionId: configured(env.GOOGLE_ADS_CONVERSION_ACTION_ID),
    apiVersion: configured(env.GOOGLE_ADS_API_VERSION) || "v25",
  };
}

export function googleAdsConfigured(settings) {
  return Boolean(
    settings.developerToken
    && settings.clientId
    && settings.clientSecret
    && settings.refreshToken
    && settings.customerId
    && settings.conversionActionId,
  );
}

export function buildGoogleAdsConversion(lead, settings) {
  if (lead?.consentForAds !== true) {
    throw new Error("Advertising-data consent is required before Google Ads attribution.");
  }

  const email = normalizedEmail(lead?.email);
  const phone = normalizedPhone(lead?.phone);
  const userIdentifiers = [
    ...(email ? [{ hashedEmail: sha256(email) }] : []),
    ...(phone ? [{ hashedPhoneNumber: sha256(phone) }] : []),
  ];

  if (!configured(lead?.gclid) && userIdentifiers.length === 0) {
    throw new Error("A Google click ID or opted-in email or phone is required for Google Ads attribution.");
  }

  const conversionValue = Number(lead?.conversionValue ?? 1);
  if (!Number.isFinite(conversionValue) || conversionValue < 0) {
    throw new Error("conversionValue must be a non-negative number.");
  }

  return {
    conversionAction: `customers/${settings.customerId}/conversionActions/${settings.conversionActionId}`,
    conversionDateTime: utcConversionDateTime(lead?.eventTime),
    conversionValue,
    currencyCode: configured(lead?.currencyCode) || "USD",
    orderId: configured(lead?.eventId) || randomUUID(),
    ...(configured(lead?.gclid) ? { gclid: configured(lead.gclid) } : {}),
    ...(userIdentifiers.length ? { userIdentifiers } : {}),
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
    throw new Error("Google Ads OAuth token refresh failed.");
  }
  return payload.access_token;
}

export async function recordGoogleAdsLead(lead, settings, fetchImpl = fetch) {
  if (!googleAdsConfigured(settings)) {
    throw new Error("Google Ads integration is not configured.");
  }

  const accessToken = await getAccessToken(settings, fetchImpl);
  const conversion = buildGoogleAdsConversion(lead, settings);
  const response = await fetchImpl(
    `${GOOGLE_ADS_API}/${settings.apiVersion}/customers/${settings.customerId}:uploadClickConversions`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "developer-token": settings.developerToken,
        ...(settings.loginCustomerId ? { "login-customer-id": settings.loginCustomerId } : {}),
        "content-type": "application/json",
      },
      body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
    },
  );
  const result = await response.json();
  if (!response.ok || result.partialFailureError) {
    throw new Error("Google Ads conversion upload failed.");
  }

  return { orderId: conversion.orderId, conversionAction: conversion.conversionAction };
}
