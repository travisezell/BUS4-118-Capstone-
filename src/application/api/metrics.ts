import { getRequests, summarize } from "../../infrastructure/lib/metrics";

export function buildMetricsPayload(includeRequests: boolean) {
  return {
    summary: summarize(),
    requests: includeRequests ? getRequests() : undefined,
  };
}
