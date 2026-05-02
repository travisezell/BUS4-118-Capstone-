/**
 * In-memory metrics logger.
 *
 * PRD §13: we report routing accuracy, retrieval hit rate, auto-resolve
 * rate, average latency, and escalation rate. This module collects the
 * raw data and exposes aggregations.
 *
 * For a long-running deployment you'd swap this for a database or a
 * proper metrics backend (StatsD, Prometheus, Datadog). For the demo,
 * a module-level array is enough.
 */

import type { Intent } from "../agents/types";

export interface RequestLog {
  userMessage: string;
  intent: Intent;
  confidence: number;
  retrievalHit: boolean;
  toolsCalled: string[];
  escalated: boolean;
  latencyMs: number;
  timestamp: number;
}

const log: RequestLog[] = [];

export function logRequest(entry: RequestLog): void {
  log.push(entry);
  // Keep the rolling window small enough to stay fast in dev.
  if (log.length > 500) log.shift();
}

export function getRequests(): RequestLog[] {
  return [...log];
}

export interface MetricsSummary {
  count: number;
  intents: Record<Intent, number>;
  averageLatencyMs: number;
  retrievalHitRate: number;
  autoResolveRate: number;
  escalationRate: number;
  toolUseRate: number;
}

export function summarize(): MetricsSummary {
  const count = log.length;
  if (count === 0) {
    return {
      count: 0,
      intents: emptyIntentCounts(),
      averageLatencyMs: 0,
      retrievalHitRate: 0,
      autoResolveRate: 0,
      escalationRate: 0,
      toolUseRate: 0,
    };
  }
  const intents = emptyIntentCounts();
  let latencySum = 0;
  let retrievalHits = 0;
  let escalations = 0;
  let toolUses = 0;
  for (const r of log) {
    intents[r.intent] = (intents[r.intent] ?? 0) + 1;
    latencySum += r.latencyMs;
    if (r.retrievalHit) retrievalHits += 1;
    if (r.escalated) escalations += 1;
    if (r.toolsCalled.length > 0) toolUses += 1;
  }
  return {
    count,
    intents,
    averageLatencyMs: latencySum / count,
    retrievalHitRate: retrievalHits / count,
    autoResolveRate: 1 - escalations / count,
    escalationRate: escalations / count,
    toolUseRate: toolUses / count,
  };
}

export function reset(): void {
  log.length = 0;
}

function emptyIntentCounts(): Record<Intent, number> {
  return {
    access_help: 0,
    account_help: 0,
    ticket_status: 0,
    general_qa: 0,
    unknown: 0,
  };
}
