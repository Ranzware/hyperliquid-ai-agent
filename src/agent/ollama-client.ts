import axios, { AxiosError } from "axios";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { settings } from "../config/settings.js";
import { logger } from "../config/logger.js";
import { TaapiClient } from "../indicators/taapi-client.js";
import type { AgentDecisionResult, LlmMessage, LlmProvider } from "../types/index.js";
import { buildSystemPrompt, holdAll, normalizeDecision } from "./llm-utils.js";

export class OllamaClient implements LlmProvider {
  private readonly baseUrl = settings.ollamaBaseUrl;
  private readonly model = settings.ollamaModel || settings.llmModel;
  private readonly taapi = new TaapiClient();

  async decideTrade(assets: string[], context: string): Promise<AgentDecisionResult> {
    return this.decide(assets, context);
  }

  private async decide(assets: string[], context: string): Promise<AgentDecisionResult> {
    if (!existsSync("logs")) mkdirSync("logs", { recursive: true });
    const messages: LlmMessage[] = [
      { role: "system", content: buildSystemPrompt(assets) },
      { role: "user", content: context },
    ];

    let allowTools = settings.enableLlmTools ?? true;

    for (let loop = 0; loop < 4; loop++) {
      const payload: Record<string, unknown> = {
        model: this.model,
        messages,
        stream: false,
        format: buildOllamaFormat(assets),
        options: {
          temperature: 0.2,
          num_predict: 2048,
        },
      };

      if (allowTools) {
        payload.tools = [taapiToolDef()];
      }

      try {
        appendFileSync(
          "logs/llm_requests.log",
          `\n\n=== ${new Date().toISOString()} ===\nProvider: ollama\nModel: ${this.model}\nPayload:\n${JSON.stringify(payload, null, 2)}\n`
        );
        logger.info({ model: this.model }, "Sending request to Ollama");
        const resp = await axios.post(`${this.baseUrl}/api/chat`, payload, { timeout: 120_000 });
        logger.info({ status: resp.status }, "Received response from Ollama");
        const data = resp.data as Record<string, unknown>;
        const message = data.message as LlmMessage | undefined;
        if (!message) {
          return holdAll(assets, "Empty response from Ollama");
        }
        messages.push(message);

        const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined) ?? [];
        if (allowTools && toolCalls.length > 0) {
          let hadTaapi = false;
          for (const tc of toolCalls) {
            if ((tc.function as { name?: string })?.name === "fetch_taapi_indicator") {
              hadTaapi = true;
              const args = JSON.parse(String((tc.function as { arguments?: string }).arguments ?? "{}")) as {
                indicator: string;
                symbol: string;
                interval: string;
                period?: number;
                backtrack?: number;
                other_params?: Record<string, unknown>;
              };
              try {
                const indResp = await this.taapi.fetchIndicatorTool(args);
                messages.push({
                  role: "tool",
                  tool_call_id: tc.id as string,
                  name: "fetch_taapi_indicator",
                  content: JSON.stringify(indResp),
                });
              } catch (ex) {
                messages.push({
                  role: "tool",
                  tool_call_id: tc.id as string,
                  name: "fetch_taapi_indicator",
                  content: `Error: ${String(ex)}`,
                });
              }
            }
          }
          if (hadTaapi) continue;
        }

        const content = String(message.content ?? "{}");
        let parsed: unknown;
        try {
          parsed = JSON.parse(content);
        } catch (err) {
          logger.error({ err, content: content.slice(0, 200) }, "Ollama JSON parse error");
          return holdAll(assets, "Parse error");
        }
        return normalizeDecision(parsed, assets);
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;
        const body = axiosErr.response?.data;
        const errText = JSON.stringify(body);
        logger.error({ status, body }, "Ollama error");
        appendFileSync("logs/llm_requests.log", `ERROR Response: ${status} - ${errText}\n`);
        if (status === 400 && allowTools) {
          logger.warn("Ollama rejected tools; retrying without tools");
          allowTools = false;
          continue;
        }
        return holdAll(assets, `Ollama request failed (HTTP ${status ?? "unknown"})`);
      }
    }

    return holdAll(assets, "Ollama loop cap");
  }
}

function taapiToolDef() {
  return {
    type: "function",
    function: {
      name: "fetch_taapi_indicator",
      description:
        'Fetch any TAAPI indicator. Available: ema, sma, rsi, macd, bbands, stochastic, stochrsi, adx, atr, cci, dmi, ichimoku, supertrend, vwap, obv, mfi, willr, roc, mom, sar, fibonacci, pivotpoints, keltner, donchian, awesome, gator, alligator, and 200+ more.',
      parameters: {
        type: "object",
        properties: {
          indicator: { type: "string" },
          symbol: { type: "string" },
          interval: { type: "string" },
          period: { type: "integer" },
          backtrack: { type: "integer" },
          other_params: {
            type: "object",
            additionalProperties: { type: ["string", "number", "boolean"] },
          },
        },
        required: ["indicator", "symbol", "interval"],
        additionalProperties: false,
      },
    },
  };
}

function buildOllamaFormat(assets: string[]) {
  return {
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
  };
}
