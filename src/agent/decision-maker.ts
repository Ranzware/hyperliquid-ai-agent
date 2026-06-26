import { settings } from "../config/settings.js";
import type { AgentDecisionResult, LlmProvider } from "../types/index.js";
import { OpenRouterClient } from "./openrouter-client.js";
import { OllamaClient } from "./ollama-client.js";

export class TradingAgent implements LlmProvider {
  private readonly provider: LlmProvider;

  constructor() {
    this.provider = settings.llmProvider === "ollama" ? new OllamaClient() : new OpenRouterClient();
  }

  async decideTrade(assets: string[], context: string): Promise<AgentDecisionResult> {
    return this.provider.decideTrade(assets, context);
  }
}
