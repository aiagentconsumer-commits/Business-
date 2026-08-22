import assert from "node:assert/strict";
import test from "node:test";
import { buildGoogleAdsConversion, recordGoogleAdsLead } from "../src/google-ads.js";

const settings = {
  developerToken: "developer-token",
  clientId: "client-id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  customerId: "1234567890",
  loginCustomerId: "0987654321",
  conversionActionId: "111222333",
  apiVersion: "v25",
};

test("builds a consented Google Ads lead conversion with hashed identifiers", () => {
  const conversion = buildGoogleAdsConversion({
    consentForAds: true,
    eventId: "lead-1",
    eventTime: "2026-08-22T10:00:00.000Z",
    email: "Avery@Example.com",
    phone: "+1 (555) 123-4567",
    gclid: "click-id",
  }, settings);

  assert.equal(conversion.orderId, "lead-1");
  assert.equal(conversion.gclid, "click-id");
  assert.equal(conversion.userIdentifiers.length, 2);
  assert.notEqual(conversion.userIdentifiers[0].hashedEmail, "avery@example.com");
});

test("rejects a Google Ads lead conversion without advertising-data consent", () => {
  assert.throws(
    () => buildGoogleAdsConversion({ email: "avery@example.com" }, settings),
    /consent/i,
  );
});

test("uploads a Google Ads lead conversion with mocked OAuth and Ads API responses", async () => {
  const requests = [];
  const fetchMock = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify(
      requests.length === 1 ? { access_token: "access-token" } : { results: [{}] },
    ), { status: 200, headers: { "content-type": "application/json" } });
  };

  const result = await recordGoogleAdsLead({
    consentForAds: true,
    eventId: "lead-2",
    gclid: "click-id",
  }, settings, fetchMock);

  assert.equal(result.orderId, "lead-2");
  assert.equal(requests.length, 2);
  assert.match(requests[1].url, /customers\/1234567890:uploadClickConversions/);
  assert.equal(requests[1].options.headers["developer-token"], "developer-token");
});
