import { describe, it, expect } from "vitest";
import { holdAll, normalizeDecision } from "./llm-utils.js";

describe("normalizeDecision", () => {
  it("normalizes valid output and fills missing assets with hold", () => {
    const result = normalizeDecision(
      {
        reasoning: "test",
        trade_decisions: [
          {
            asset: "BTC",
            action: "buy",
            allocation_usd: 100,
            tp_price: 70_000,
            sl_price: 60_000,
            exit_plan: "tp/sl",
            rationale: "bullish",
          },
        ],
      },
      ["BTC", "ETH"]
    );
    expect(result.trade_decisions).toHaveLength(2);
    expect(result.trade_decisions[0].action).toBe("buy");
    expect(result.trade_decisions[1].asset).toBe("ETH");
    expect(result.trade_decisions[1].action).toBe("hold");
  });

  it("throws on invalid schema", () => {
    expect(() => normalizeDecision({ foo: "bar" }, ["BTC"])).toThrow();
  });
});

describe("holdAll", () => {
  it("returns hold for every asset", () => {
    const result = holdAll(["BTC", "ETH"], "reason");
    expect(result.trade_decisions.every((d) => d.action === "hold")).toBe(true);
    expect(result.trade_decisions.every((d) => d.rationale === "reason")).toBe(true);
  });
});
