/**
 * Thin fetch wrapper shared by all three service query modules. Each service
 * has its own base URL (no BFF/gateway exists — see docs/plan-phase4.md
 * section 3) and its own generated types; this module only handles the
 * mechanical parts: base URL selection, JSON encode/decode, and turning a
 * non-2xx response into a typed error the caller can inspect.
 */

export type ServiceName = "menu" | "availability" | "pos" | "trace";

const BASE_URLS: Record<ServiceName, string> = {
  menu: import.meta.env.VITE_MENU_API_URL ?? "http://localhost:8081",
  availability: import.meta.env.VITE_AVAILABILITY_API_URL ?? "http://localhost:8082",
  pos: import.meta.env.VITE_POS_API_URL ?? "http://localhost:8083",
  trace: import.meta.env.VITE_TRACE_API_URL ?? "http://localhost:8084",
};

/** Exposed so useTraceStream (a raw EventSource, not a JSON fetch) can build the SSE URL. */
export function serviceBaseUrl(service: ServiceName): string {
  return BASE_URLS[service];
}

/**
 * Thrown for any non-2xx response. `body` is the parsed JSON error payload
 * (shape varies per endpoint — callers that care about a specific shape,
 * e.g. menu-service's ConflictResponse on 409, narrow it themselves after
 * checking `status`).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(service: ServiceName, path: string, query?: RequestOptions["query"]): string {
  const url = new URL(BASE_URLS[service] + path);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(
  service: ServiceName,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const res = await fetch(buildUrl(service, path, options.query), {
    method: options.method ?? "GET",
    headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  const text = await res.text();
  const parsed = text.length > 0 ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, parsed);
  }

  return parsed as T;
}
