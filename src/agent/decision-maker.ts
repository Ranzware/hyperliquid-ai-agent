import type { AgentDecisionResult, LlmProvider } from "../types/index.js";
import { OllamaClient } from "./ollama-client.js";

export class TradingAgent implements LlmProvider {
  private readonly provider: LlmProvider = new OllamaClient();

  async decideTrade(assets: string[], context: string): Promise<AgentDecisionResult> {
    return this.provider.decideTrade(assets, context);
  }
}
