// R2 free-tier accounting. Source: https://developers.cloudflare.com/r2/pricing/ (checked 2026-11-01).
// Zero-charge rule: we never aim for the free tier itself, only for an internal budget below it.

export const CLASS_A = new Set([
  "ListBuckets", "PutBucket", "ListObjects", "PutObject", "CopyObject",
  "CompleteMultipartUpload", "CreateMultipartUpload", "LifecycleStorageTierTransition",
  "ListMultipartUploads", "UploadPart", "UploadPartCopy", "ListParts",
  "PutBucketEncryption", "PutBucketCors", "PutBucketLifecycleConfiguration",
]);

export const CLASS_B = new Set([
  "HeadBucket", "HeadObject", "GetObject", "UsageSummary",
  "GetBucketEncryption", "GetBucketLocation", "GetBucketCors", "GetBucketLifecycleConfiguration",
]);

export const FREE_OPS = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

// Decimal GB is smaller than GiB, so this errs on the safe side.
export const FREE_TIER = {
  storageBytes: 10 * 1000 ** 3,
  classA: 1_000_000,
  classB: 10_000_000,
} as const;

/** Internal budget = this fraction of the free tier (docs/quotas.md). */
export const BUDGET_FRACTION = 0.5;

/** Thresholds are fractions of the internal budget, not of the free tier. */
export const THRESHOLDS = {
  warn: 0.7,
  stopUploads: 0.9,
  stopAll: 0.95,
} as const;

export type Level = "ok" | "warn" | "stop_uploads" | "stop_all";

export interface Usage {
  storageBytes: number;
  classA: number;
  classB: number;
  /** Operations not in any known list. Counted as Class A to stay conservative. */
  unknownOps: number;
}

export interface Evaluation {
  level: Level;
  /** Usage as a fraction of the internal budget, per metric. */
  budgetUsed: { storage: number; classA: number; classB: number };
  worst: number;
}

export interface OpsRow {
  actionType: string;
  requests: number;
}

export function classifyOps(rows: OpsRow[]): Pick<Usage, "classA" | "classB" | "unknownOps"> {
  let classA = 0;
  let classB = 0;
  let unknownOps = 0;
  for (const { actionType, requests } of rows) {
    if (CLASS_A.has(actionType)) classA += requests;
    else if (CLASS_B.has(actionType)) classB += requests;
    else if (!FREE_OPS.has(actionType)) unknownOps += requests;
  }
  return { classA, classB, unknownOps };
}

export function evaluate(usage: Usage): Evaluation {
  const budget = (limit: number) => limit * BUDGET_FRACTION;
  const budgetUsed = {
    storage: usage.storageBytes / budget(FREE_TIER.storageBytes),
    classA: (usage.classA + usage.unknownOps) / budget(FREE_TIER.classA),
    classB: usage.classB / budget(FREE_TIER.classB),
  };
  const worst = Math.max(budgetUsed.storage, budgetUsed.classA, budgetUsed.classB);
  return { level: levelFor(worst), budgetUsed, worst };
}

export function levelFor(fraction: number): Level {
  if (fraction >= THRESHOLDS.stopAll) return "stop_all";
  if (fraction >= THRESHOLDS.stopUploads) return "stop_uploads";
  if (fraction >= THRESHOLDS.warn) return "warn";
  return "ok";
}

const ORDER: Level[] = ["ok", "warn", "stop_uploads", "stop_all"];

export function severity(level: Level): number {
  return ORDER.indexOf(level);
}
