// Load test against storefront-api's one real endpoint: the composed venue menu. Targets a
// single venueId (seed one via menu-service first — see README's load-test section for the
// exact commands) so the run exercises the intended path — cold-cache upstream fan-out to
// menu-service+availability-service on the first hit per VU, Redis cache hits after
// (STOREFRONT_MENU_CACHE_TTL_SECONDS, default 5s) — the exact tradeoff ADR 0007 documents.
import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.STOREFRONT_URL || "http://localhost:8085";
const VENUE_ID = __ENV.VENUE_ID;

if (!VENUE_ID) {
  throw new Error("VENUE_ID env var is required — seed a venue via menu-service first");
}

export const options = {
  scenarios: {
    constant_load: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 50),
      duration: __ENV.DURATION || "2m",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
  },
  summaryTrendStats: ["avg", "min", "med", "p(50)", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const res = http.get(`${BASE_URL}/venues/${VENUE_ID}/menu`);
  check(res, {
    "status is 200": (r) => r.status === 200,
  });
}
