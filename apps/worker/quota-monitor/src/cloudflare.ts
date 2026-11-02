// Reads R2 usage from the Cloudflare GraphQL Analytics API.
// Datasets: https://developers.cloudflare.com/r2/platform/metrics-analytics/
import { fetchWithRetry, type RetryOptions } from "../../shared/http";
import { classifyOps, type OpsRow, type Usage } from "./usage";

export const GRAPHQL_URL = "https://api.cloudflare.com/client/v4/graphql";

/** The API allows at most 31 days; using the full window covers any billing month-to-date. */
export const WINDOW_DAYS = 31;

const QUERY = `
query R2Usage($accountTag: string!, $start: Time!, $end: Time!) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      ops: r2OperationsAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        sum { requests }
        dimensions { actionType }
      }
      storage: r2StorageAdaptiveGroups(
        limit: 10000
        filter: { datetime_geq: $start, datetime_leq: $end }
      ) {
        max { payloadSize metadataSize }
        dimensions { bucketName }
      }
    }
  }
}`;

interface GraphQLResponse {
  data?: {
    viewer?: {
      accounts?: Array<{
        ops?: Array<{ sum: { requests: number }; dimensions: { actionType: string } }>;
        storage?: Array<{ max: { payloadSize: number; metadataSize: number }; dimensions: { bucketName: string } }>;
      }>;
    };
  };
  errors?: Array<{ message: string }> | null;
}

export async function fetchR2Usage(
  fetchFn: typeof fetch,
  accountId: string,
  apiToken: string,
  now: Date,
  retry?: RetryOptions,
): Promise<Usage> {
  const start = new Date(now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000);
  const res = await fetchWithRetry(
    fetchFn,
    GRAPHQL_URL,
    {
      method: "POST",
      headers: { authorization: `Bearer ${apiToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        query: QUERY,
        variables: { accountTag: accountId, start: start.toISOString(), end: now.toISOString() },
      }),
    },
    // Read-only GraphQL query sent as POST: safe to repeat.
    { ...retry, idempotent: true },
  );
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);

  const body = (await res.json()) as GraphQLResponse;
  if (body.errors?.length) throw new Error(`GraphQL: ${body.errors.map((e) => e.message).join("; ")}`);

  const account = body.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("GraphQL: account not found in response");

  const rows: OpsRow[] = (account.ops ?? []).map((r) => ({
    actionType: r.dimensions.actionType,
    requests: r.sum.requests,
  }));
  // Peak size per bucket over the window, summed: conservative versus the GB-month average.
  const storageBytes = (account.storage ?? []).reduce(
    (acc, r) => acc + r.max.payloadSize + r.max.metadataSize,
    0,
  );
  return { storageBytes, ...classifyOps(rows) };
}
