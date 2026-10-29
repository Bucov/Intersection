import { z } from "zod";
import { ComparisonResponseSchema, CreateComparisonRequestSchema, CreateSessionRequestSchema, EventsQuerySchema, EventsResponseSchema, HealthResponseSchema, InjectEventRequestSchema, InjectEventResponseSchema, MetricsQuerySchema, MetricsResponseSchema, RuntimeConfigResponseSchema, ScenariosResponseSchema, SessionControlRequestSchema, SessionPathSchema, SessionResponseSchema } from "../schemas/api.js";
import { ErrorEnvelopeSchema } from "../schemas/events.js";

/** Executable contract metadata; these declarations do not register HTTP handlers. */
export const REST_CONTRACT = {
  health: { method: "GET", path: "/api/health", response: HealthResponseSchema, successStatus: 200 },
  config: { method: "GET", path: "/api/config", response: RuntimeConfigResponseSchema, successStatus: 200 },
  scenarios: { method: "GET", path: "/api/scenarios", response: ScenariosResponseSchema, successStatus: 200 },
  createSession: { method: "POST", path: "/api/sessions", body: CreateSessionRequestSchema, response: SessionResponseSchema, successStatus: 201 },
  getSession: { method: "GET", path: "/api/sessions/:id", params: SessionPathSchema, response: SessionResponseSchema, successStatus: 200 },
  controlSession: { method: "POST", path: "/api/sessions/:id/control", params: SessionPathSchema, body: SessionControlRequestSchema, response: SessionResponseSchema, successStatus: 200 },
  injectEvent: { method: "POST", path: "/api/sessions/:id/inject", params: SessionPathSchema, body: InjectEventRequestSchema, response: InjectEventResponseSchema, successStatus: 202 },
  getEvents: { method: "GET", path: "/api/sessions/:id/events", params: SessionPathSchema, query: EventsQuerySchema, response: EventsResponseSchema, successStatus: 200 },
  getMetrics: { method: "GET", path: "/api/sessions/:id/metrics", params: SessionPathSchema, query: MetricsQuerySchema, response: MetricsResponseSchema, successStatus: 200 },
  createComparison: { method: "POST", path: "/api/comparisons", body: CreateComparisonRequestSchema, response: ComparisonResponseSchema, successStatus: 202 },
  getComparison: { method: "GET", path: "/api/comparisons/:id", params: SessionPathSchema, response: ComparisonResponseSchema, successStatus: 200 },
} as const;
export type RestOperation = keyof typeof REST_CONTRACT;
export type RestResponse<K extends RestOperation> = z.infer<(typeof REST_CONTRACT)[K]["response"]>;
export const REST_ERROR_SCHEMA = ErrorEnvelopeSchema;
