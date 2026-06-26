import axios, { AxiosError } from "axios";
import { appendFileSync } from "node:fs";
import { settings } from "../config/settings.js";
import { logger } from "../config/logger.js";
import { TaapiClient } from "../indicators/taapi-client.js";
import type { AgentDecisionResult, LlmMessage, LlmProvider } from "../types/index.js";
import { buildSystemPrompt, buildToolSchema, holdAll, normalizeDecision } from "./llm-utils.js";

export class OpenRouterClient implements LlmProvider {
  private readonly model = settings.llmModel;
  private readonly apiKey = settings.openrouterApiKey;
  private readonly baseUrl = `${settings.openrouterBaseUrl}/chat/completions`;
  private readonly referer = settings.openrouterReferer;
  private readonly appTitle = settings.openrouterAppTitle;
  private readonly taapi = new TaapiClient();

  async decideTrade(assets: string[], context: string): Promise<AgentDecisionResult> {
    return this.decide(assets, context);
  }

  private async decide(assets: string[], context: string): Promise<AgentDecisionResult> {
    const systemPrompt = buildSystemPrompt(assets);
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: context },
    ];

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.referer) headers["HTTP-Referer"] = this.referer;
    if (this.appTitle) headers["X-Title"] = this.appTitle;

    const post = async (payload: Record<string, unknown>) => {
      logger.info({ model: payload.model }, "Sending request to OpenRouter");
      appendFileSync(
        "logs/llm_requests.log",
        `\n\n=== ${new Date().toISOString()} ===\nModel: ${payload.model}\nPayload:\n${JSON.stringify(payload, null, 2)}\n`
      );
      const resp = await axios.post(this.baseUrl, payload, { headers, timeout: 60_000 });
      logger.info({ status: resp.status }, "Received response from OpenRouter");
      return resp.data as Record<string, unknown>;
    };

    let allowTools = settings.enableLlmTools ?? true;
    let allowStructured = true;

    for (let loop = 0; loop < 6; loop++) {
      const data: Record<string, unknown> = { model: this.model, messages };
      if (allowStructured) {
        data.response_format = buildToolSchema(assets);
      }
      if (allowTools) {
        data.tools = [taapiToolDef()];
        data.tool_choice = "auto";
      }
      if (settings.reasoningEnabled) {
        data.reasoning = { effort: settings.reasoningEffort };
      }
      if (settings.providerConfig || settings.providerQuantizations) {
        let providerPayload: Record<string, unknown> = {};
        if (settings.providerConfig) {
          providerPayload = { ...providerPayload, ...settings.providerConfig };
        }
        if (settings.providerQuantizations) {
          providerPayload.quantizations = settings.providerQuantizations;
        }
        data.provider = providerPayload;
      }

      let respJson: Record<string, unknown>;
      try {
        respJson = await post(data);
      } catch (err) {
        const axiosErr = err as AxiosError<{ error?: { metadata?: { raw?: string; provider_name?: string } } }>;
        const status = axiosErr.response?.status;
        const errBody = axiosErr.response?.data ?? {};
        const raw = errBody.error?.metadata?.raw ?? "";
        const provider = errBody.error?.metadata?.provider_name ?? "";
        const errText = JSON.stringify(errBody);

        if (status === 422 && provider.toLowerCase().startsWith("xai") && raw.toLowerCase().includes("deserialize")) {
          logger.warn("xAI rejected tool schema; retrying without tools");
          if (allowTools) {
            allowTools = false;
            continue;
          }
        }
        if (allowStructured && (errText.includes("response_format") || errText.includes("structured") || status === 400 || status === 422)) {
          logger.warn("Provider rejected structured outputs; retrying without response_format");
          allowStructured = false;
          continue;
        }
        logger.error({ status, body: errBody }, "OpenRouter error");
        appendFileSync("logs/llm_requests.log", `ERROR Response: ${status} - ${errText}\n`);
        return holdAll(assets, `LLM request failed (HTTP ${status ?? "unknown"})`);
      }

      const choices = respJson.choices as Array<{ message: LlmMessage }> | undefined;
      const choice = choices?.[0];
      if (!choice) {
        return holdAll(assets, "Empty response from OpenRouter");
      }
      const message = choice.message;
      messages.push(message);

      const toolCalls = (message.tool_calls as Array<Record<string, unknown>> | undefined) ?? [];
      if (allowTools && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          if (tc.type === "function" && (tc.function as { name?: string })?.name === "fetch_taapi_indicator") {
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
        continue;
      }

      try {
        let parsed: unknown;
        if (message.parsed && typeof message.parsed === "object") {
          parsed = message.parsed;
        } else {
          parsed = JSON.parse(String(message.content ?? "{}"));
        }
        return normalizeDecision(parsed, assets);
      } catch (err) {
        logger.error({ err, content: String(message.content ?? "").slice(0, 200) }, "JSON parse error");
        return holdAll(assets, "Parse error");
      }
    }

    return holdAll(assets, "tool loop cap");
  }
}

function taapiToolDef() {
  return {
    type: "function",
    function: {
      name: "fetch_taapi_indicator",
      description:
        'Fetch any TAAPI indicator. Available: ema, sma, rsi, macd, bbands, stochastic, stochrsi, adx, atr, cci, dmi, ichimoku, supertrend, vwap, obv, mfi, willr, roc, mom, sar, fibonacci, pivotpoints, keltner, donchian, awesome, gator, alligator, and 200+ more. See https://taapi.io/indicators/',
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
