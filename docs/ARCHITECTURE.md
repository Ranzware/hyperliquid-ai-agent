## Trading Agent Architecture (High-Level)

This document outlines the end-to-end flow of the trading agent at a conceptual level. It focuses on subsystems, data flows, and guardrails rather than specific functions.

### Subsystems
- Config/Env: Centralized runtime settings from `.env` (keys, model, assets, interval, risk limits, provider).
- Agent Runtime Loop: Schedules periodic decisions per `--interval` and coordinates all subsystems.
- State Store: Persists active trades, price history, and counters to Redis (if available) plus disk fallback (`DATA_DIR`).
- Context Builder: Prepares the prompt context with authoritative exchange state, indicators, recent fills, active orders, local diary, and sampled perp mid prices.
- Decision Engine:
  - Provider Router: selects OpenRouter or Ollama based on `LLM_PROVIDER`.
  - OpenRouter provider: JSON-schema structured outputs, optional tool calling for TAAPI indicators, provider/quantization hints.
  - Ollama provider: Native `/api/chat` with JSON-schema `format`, automatic tool fallback.
  - Shared normalizer: Zod-validates LLM output and fills missing assets with `hold`.
- Risk/Collateral Gate: Validates proposed allocations vs available capital, free-collateral, max positions, per-asset exposure, and daily loss halt.
- Execution Layer: Places market/trigger orders, confirms fills, and extracts order identifiers.
- Reconciliation: Resolves local intent vs exchange truth (positions/open orders/fills), purges stale local state, and logs outcomes.
- Observability: Minimal HTTP API with `/health`, `/diary`, and `/logs` (path-restricted to `LOG_DIR`).

### Data Principles
- Authoritative Source: Exchange state (positions, open orders, fills, mids) always supersedes local intent.
- Perp-Only Pricing: Price context comes from Hyperliquid mids; no spot/perp basis mixing.
- Compact Signals: Indicators (5m/4h EMA/MACD/RSI) and short sampled price histories keep context lean and informative.
- Time Semantics: Timestamps are UTC ISO; MinutesOpen computed from stored open times.
- Persistence: State survives process restarts via Redis + disk fallback.

### Robustness
- Structured Outputs: Use JSON Schema; fallback to hold-all on parse failures.
- Retry Strategy: Single retry with stricter instruction to output schema-only JSON.
- Fill Confirmation: TP/SL are only placed after a confirmed fill, sized to the actual filled amount.
- Risk Gate: Hard env-configurable limits prevent oversized or over-leveraged trades.
- Reconciliation: Regularly remove stale active trades when no position and no orders exist; log reconcile events.
- Logging: Requests/responses and diary entries recorded under `LOG_DIR` for traceability.
