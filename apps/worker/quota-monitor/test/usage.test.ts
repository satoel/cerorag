import { describe, expect, it } from "vitest";
import { classifyOps, evaluate, FREE_TIER, levelFor } from "../src/usage";

const budget = (limit: number) => limit * 0.5;

describe("classifyOps", () => {
  it("splits class A, class B and free operations", () => {
    const r = classifyOps([
      { actionType: "PutObject", requests: 10 },
      { actionType: "ListObjects", requests: 5 },
      { actionType: "GetObject", requests: 100 },
      { actionType: "HeadObject", requests: 1 },
      { actionType: "DeleteObject", requests: 50 },
    ]);
    expect(r).toEqual({ classA: 15, classB: 101, unknownOps: 0 });
  });

  it("tracks unknown operations separately so they can be billed as class A", () => {
    expect(classifyOps([{ actionType: "SomethingNew", requests: 7 }]).unknownOps).toBe(7);
  });
});

describe("levelFor", () => {
  it.each([
    [0, "ok"],
    [0.69, "ok"],
    [0.7, "warn"],
    [0.89, "warn"],
    [0.9, "stop_uploads"],
    [0.95, "stop_all"],
    [2, "stop_all"],
  ] as const)("%s -> %s", (fraction, level) => {
    expect(levelFor(fraction)).toBe(level);
  });
});

describe("evaluate", () => {
  it("measures against the internal budget (50% of the free tier)", () => {
    const ev = evaluate({ storageBytes: budget(FREE_TIER.storageBytes) * 0.7, classA: 0, classB: 0, unknownOps: 0 });
    expect(ev.level).toBe("warn");
    expect(ev.budgetUsed.storage).toBeCloseTo(0.7);
  });

  it("simulated 70% of class A budget alerts", () => {
    expect(evaluate({ storageBytes: 0, classA: budget(FREE_TIER.classA) * 0.7, classB: 0, unknownOps: 0 }).level).toBe("warn");
  });

  it("simulated 90% of class B budget triggers the upload kill switch", () => {
    expect(evaluate({ storageBytes: 0, classA: 0, classB: budget(FREE_TIER.classB) * 0.9, unknownOps: 0 }).level).toBe(
      "stop_uploads",
    );
  });

  it("counts unknown operations against class A", () => {
    const ev = evaluate({ storageBytes: 0, classA: 0, classB: 0, unknownOps: budget(FREE_TIER.classA) });
    expect(ev.level).toBe("stop_all");
  });

  it("the worst metric decides", () => {
    const ev = evaluate({ storageBytes: 1, classA: 1, classB: budget(FREE_TIER.classB) * 0.96, unknownOps: 0 });
    expect(ev.level).toBe("stop_all");
  });

  it("free-tier usage itself is never reached before stop_all", () => {
    // stop_all fires at 95% of a 50% budget = 47.5% of the real free tier.
    const ev = evaluate({ storageBytes: FREE_TIER.storageBytes * 0.475, classA: 0, classB: 0, unknownOps: 0 });
    expect(ev.level).toBe("stop_all");
  });
});
