import { z } from "zod";
import type { AgentDecisionResult, TradeDecision } from "../types/index.js";

const tradeDecisionSchema = z.object({
  asset: z.string(),
  action: z.enum(["buy", "sell", "hold"]),
  allocation_usd: z.number().min(0),
  tp_price: z.number().nullable(),
  sl_price: z.number().nullable(),
  exit_plan: z.string(),
  rationale: z.string(),
});

export const agentDecisionSchema = z.object({
  reasoning: z.string(),
  trade_decisions: z.array(tradeDecisionSchema).min(1),
});

export function normalizeDecision(
  parsed: unknown,
  expectedAssets: string[]
): AgentDecisionResult {
  const validated = agentDecisionSchema.parse(parsed);
  const decisions: TradeDecision[] = expectedAssets.map((asset) => {
    const match = validated.trade_decisions.find((d) => d.asset === asset);
    if (match) {
      return {
        asset: match.asset,
        action: match.action,
        allocation_usd: Number(match.allocation_usd ?? 0),
        tp_price: match.tp_price ?? null,
        sl_price: match.sl_price ?? null,
        exit_plan: match.exit_plan ?? "",
        rationale: match.rationale ?? "",
      };
    }
    return {
      asset,
      action: "hold" as const,
      allocation_usd: 0,
      tp_price: null,
      sl_price: null,
      exit_plan: "",
      rationale: "No decision returned for asset",
    };
  });
  return {
    reasoning: validated.reasoning ?? "",
    trade_decisions: decisions,
  };
}

export function holdAll(assets: string[], reason: string): AgentDecisionResult {
  return {
    reasoning: reason,
    trade_decisions: assets.map((asset) => ({
      asset,
      action: "hold" as const,
      allocation_usd: 0,
      tp_price: null,
      sl_price: null,
      exit_plan: "",
      rationale: reason,
    })),
  };
}

export function buildSystemPrompt(assets: string[]): string {
  return [
    "You are a rigorous QUANTITATIVE TRADER optimizing risk-adjusted returns for perpetual futures.",
    "You will receive market + account context for SEVERAL assets.",
    "Always use the 'current time' provided in the user message to evaluate time-based conditions such as cooldown expirations or timed exit plans.",
    "Your goal: make decisive, first-principles decisions per asset that minimize churn while capturing edge.",
    "",
    "Output a STRICT JSON object with exactly two properties: reasoning and trade_decisions.",
    "Each trade_decisions item must contain {asset, action, allocation_usd, tp_price, sl_price, exit_plan, rationale}.",
    "Do not emit Markdown or any extra properties.",
    "Assets under consideration: " + JSON.stringify(assets),
  ].join("\n");
}

export function buildToolSchema(assets: string[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "trade_decisions",
      strict: true,
      schema: {
        type: "object",
        properties: {
          reasoning: { type: "string" },
          trade_decisions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                asset: { type: "string", enum: assets },
                action: { type: "string", enum: ["buy", "sell", "hold"] },
                allocation_usd: { type: "number", minimum: 0 },
                tp_price: { type: ["number", "null"] },
                sl_price: { type: ["number", "null"] },
                exit_plan: { type: "string" },
                rationale: { type: "string" },
              },
              required: ["asset", "action", "allocation_usd", "tp_price", "sl_price", "exit_plan", "rationale"],
              additionalProperties: false,
            },
            minItems: 1,
          },
        },
        required: ["reasoning", "trade_decisions"],
        additionalProperties: false,
      },
    },
  };
}
