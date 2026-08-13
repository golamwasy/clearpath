import { useQueries } from "@tanstack/react-query";
import { apiRequest, type ServiceName } from "../client";

export interface ServiceDescriptor {
  service: ServiceName;
  label: string;
  language: string;
  stores: string;
  role: string;
}

/**
 * The four services merchant-web actually talks to, in the order a write travels through them.
 *
 * storefront-api is deliberately absent: it is a real service and it is on the flow diagram, but it
 * sends no CORS headers (CLAUDE.md lists CORS on menu-service, availability-service, pos-ingest and
 * trace-collector only), so a browser cannot reach it. Showing it here with a permanently red dot
 * would report a broken service when the service is fine — the honest thing is to leave it off a
 * panel titled "services this page is talking to" and say so in the caption.
 */
export const MONITORED_SERVICES: ServiceDescriptor[] = [
  {
    service: "menu",
    label: "menu-service",
    language: "Kotlin / Ktor",
    stores: "Postgres",
    role: "Canonical menu, transactional outbox",
  },
  {
    service: "availability",
    label: "availability-service",
    language: "Kotlin / Ktor",
    stores: "Redis, Mongo",
    role: "Hot read path, stock state, audit",
  },
  {
    service: "pos",
    label: "pos-ingest",
    language: "Go",
    stores: "Postgres",
    role: "Concurrent POS polling, normalization",
  },
  {
    service: "trace",
    label: "trace-collector",
    language: "Kotlin / Ktor",
    stores: "Mongo",
    role: "Trace ingestion, SSE fanout",
  },
];

/**
 * Polls each service's own `/health` endpoint — the same one the Kubernetes `livenessProbe` in
 * `deploy/k8s/` hits. A red dot here means that container really is not answering; nothing about
 * this panel is derived or assumed.
 *
 * `retry: false` because a failed health check is the result, not an error to paper over: retrying
 * would just delay showing the operator that a service is down.
 */
export function useServiceHealth() {
  return useQueries({
    queries: MONITORED_SERVICES.map((descriptor) => ({
      queryKey: ["health", descriptor.service] as const,
      queryFn: async () => {
        const startedAt = performance.now();
        await apiRequest<{ status: string }>(descriptor.service, "/health");
        return { latencyMs: Math.round(performance.now() - startedAt) };
      },
      refetchInterval: 5000,
      retry: false,
    })),
    combine: (results) =>
      MONITORED_SERVICES.map((descriptor, index) => ({
        ...descriptor,
        isUp: results[index].isSuccess,
        isPending: results[index].isPending,
        latencyMs: results[index].data?.latencyMs ?? null,
      })),
  });
}
