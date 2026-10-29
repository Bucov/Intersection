import { ErrorEnvelopeSchema } from "@intersection/shared";
import { TransportError } from "./IntersectionTransport";

/** Structural view of a Zod schema, so this module does not depend on Zod directly. */
export interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export interface RequestOptions<T> {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  schema: Parser<T>;
  timeoutMs?: number;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function joinUrl(base: string, path: string, query?: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) search.set(key, String(value));
  const qs = search.toString();
  return `${base.replace(/\/$/, "")}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * JSON request validated against a shared contract schema. Contract errors
 * (`ErrorEnvelope`) become `TransportError`s with the server's code; network
 * failures, timeouts and shape mismatches get NETWORK / TIMEOUT / PROTOCOL.
 */
export async function requestJson<T>(fetchImpl: FetchLike, base: string, path: string, options: RequestOptions<T>): Promise<T> {
  const url = joinUrl(base, path, options.query);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: options.method ?? "GET",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
    });
  } catch (error) {
    const timeout = error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new TransportError(timeout ? "TIMEOUT" : "NETWORK", timeout ? "The backend did not answer in time." : "Could not reach the backend.", { retryable: true });
  }

  const text = await response.text().catch(() => "");
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!response.ok) {
    const envelope = ErrorEnvelopeSchema.safeParse(json);
    if (envelope.success) {
      const { error } = envelope.data;
      throw new TransportError(error.code, error.message, { status: response.status, retryable: error.retryable, detail: error });
    }
    const gateway = response.status === 502 || response.status === 503 || response.status === 504;
    throw new TransportError(gateway ? "NETWORK" : "PROTOCOL", gateway ? "The backend is not reachable." : `Unexpected HTTP ${response.status} from the backend.`, {
      status: response.status,
      retryable: response.status >= 500,
    });
  }

  const parsed = options.schema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue ? `${issue.path.map(String).join(".") || "response"}: ${issue.message}` : "unknown shape";
    throw new TransportError("PROTOCOL", `The backend response does not match the v1 contract (${where}).`, { status: response.status });
  }
  return parsed.data;
}
