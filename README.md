# Taprwhiz: AI Trading Agent on Hyperliquid
<img width="1424" height="720" alt="image" src="https://github.com/user-attachments/assets/256241a1-a2ed-4830-96d4-6ffbbda75a77" />

This project implements an AI-powered trading agent that uses an Ollama-hosted LLM to analyze real-time market data from TAAPI, make buy/sell/hold decisions, and execute trades on the Hyperliquid decentralized exchange. It runs in a continuous loop at a configurable interval, manages positions with take-profit and stop-loss orders, and persists state so it survives restarts.

## Table of Contents

- [Disclaimer](#disclaimer)
- [Architecture](#architecture)
- [Structure](#structure)
- [Env Configuration](#env-configuration)
- [Usage](#usage)
- [Ollama Cloud](#ollama-cloud)
- [Coolify Deployment](#coolify-deployment)
- [Tool Calling](#tool-calling)
- [Deployment to EigenCloud](#deployment-to-eigencloud)

## Disclaimer

There is no guarantee of any returns. This code has not been audited. Please use at your own risk.

## Architecture

See the full [Architecture Documentation](docs/ARCHITECTURE.md) for subsystems, data flow, and design principles.

## Structure
- `src/index.ts`: Entry point, CLI parsing, API server, and trading loop bootstrap.
- `src/agent/decision-maker.ts`: LLM provider router (Ollama-only).
- `src/agent/ollama-client.ts`: Ollama provider with JSON-schema structured output and optional tool calling.
- `src/agent/llm-utils.ts`: Shared prompts, schema, and normalization.
- `src/indicators/taapi-client.ts`: Fetches indicators from TAAPI.
- `src/trading/hyperliquid-api.ts`: Executes trades on Hyperliquid.
- `src/trading/risk-gate.ts`: Pre-trade risk and collateral checks.
- `src/config/settings.ts`: Centralized config loaded from `.env`.
- `src/config/state-store.ts`: Redis + disk persistence for active trades.
- `src/api/server.ts`: Minimal HTTP API with safe log access.

## Env Configuration
Populate `.env` (use `.env.example` as reference):
- TAAPI_API_KEY
- HYPERLIQUID_PRIVATE_KEY (or LIGHTER_PRIVATE_KEY)
- OLLAMA_BASE_URL
- OLLAMA_MODEL
- OLLAMA_API_KEY (if your provider requires auth)
- ASSETS, INTERVAL

### Obtaining API Keys
- **TAAPI_API_KEY**: Sign up at [TAAPI.io](https://taapi.io/) and generate an API key from your dashboard.
- **HYPERLIQUID_PRIVATE_KEY**: Generate an Ethereum-compatible private key for Hyperliquid. Use tools like MetaMask or `eth_account` library. For security, never share this key.
- **OLLAMA_API_KEY**: Only needed for Ollama cloud / hosted providers that require Bearer token authentication.

## Usage
Run: `npm run dev -- --assets BTC ETH --interval 1h`

Or after building:
```bash
npm install
npm run build
npm start -- --assets BTC ETH --interval 1h
```

### Local API Endpoints
When the agent runs, it also serves a minimal API:
- `GET /health` — agent status.
- `GET /diary?limit=200` — returns recent JSONL diary entries as JSON.
- `GET /logs?path=llm_requests.log&limit=2000` — tails the specified log file (only files inside `LOG_DIR` are allowed).

Configure bind host/port via env:
- `API_HOST` (default `0.0.0.0`)
- `API_PORT` or `APP_PORT` (default `3000`)

Docker:
```bash
docker build --platform linux/amd64 -t trading-agent .
docker run --rm -p 3000:3000 --env-file .env trading-agent
# Now: curl http://localhost:3000/diary
```

## Ollama Cloud

Set your Ollama-compatible endpoint and model:

```env
OLLAMA_BASE_URL=https://api.ollama.com/v1
OLLAMA_MODEL=llama3.1:8b
OLLAMA_API_KEY=your_ollama_cloud_key
```

The agent uses Ollama's native `/api/chat` endpoint with JSON-schema `format` for structured outputs. The `Authorization: Bearer <OLLAMA_API_KEY>` header is sent when the key is set. Tool calling is off by default; enable with `ENABLE_LLM_TOOLS=true`.

## Coolify Deployment

1. Add a new **Application** resource in Coolify.
2. Select your Git repo and choose **Dockerfile** as the build pack.
3. Set the required environment variables from `.env.example`.
4. Add persistent storage for `/app/logs` and `/app/.data`.
5. Expose container port `3000` and use `/health` as the healthcheck endpoint.
6. Make sure `API_HOST=0.0.0.0` (default) so Coolify can route traffic into the container.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for additional Coolify notes.

## Tool Calling
The agent can dynamically fetch any TAAPI indicator (e.g., EMA, RSI) via tool calls. See [TAAPI Indicators](https://taapi.io/indicators/) and [EMA Example](https://taapi.io/indicators/exponential-moving-average/) for details. Set `ENABLE_LLM_TOOLS=true` to enable; disabled by default for broad Ollama compatibility.

## Risk Controls
The following environment variables configure pre-trade safety:
- `MAX_ALLOCATION_PCT` — max % of account value per new trade (default 20).
- `MAX_POSITIONS` — max number of simultaneous positions (default 10).
- `MIN_FREE_COLLATERAL_PCT` — minimum free collateral to leave untouched (default 20).
- `DAILY_LOSS_HALT_PCT` — halt trading after this daily drawdown (default 10).

## Deployment to EigenCloud

EigenCloud (via EigenX CLI) allows deploying this trading agent in a Trusted Execution Environment (TEE) with secure key management.

### Prerequisites
- Allowlisted Ethereum account (Sepolia for testnet). Request onboarding at [EigenCloud Onboarding](https://onboarding.eigencloud.xyz).
- Docker installed.
- Sepolia ETH for deployments.

### Installation
#### macOS/Linux
```bash
curl -fsSL https://eigenx-scripts.s3.us-east-1.amazonaws.com/install-eigenx.sh | bash
```

#### Windows
```bash
curl -fsSL https://eigenx-scripts.s3.us-east-1.amazonaws.com/install-eigenx.ps1 | powershell -
```

### Initial Setup
```bash
docker login
eigenx auth login  # Or eigenx auth generate --store (if you don't have a eth account, keep this account separate from your trading account)
```

### Deploy the Agent
From the project directory:
```bash
cp .env.example .env
# Edit .env: set ASSETS, INTERVAL, API keys
eigenx app deploy
```

### Monitoring
```bash
eigenx app info --watch
eigenx app logs --watch
```

### Updates
Edit code or .env, then:
```bash
eigenx app upgrade <app-name>
```

For full CLI reference, see the [EigenX Documentation](https://github.com/Layr-Labs/eigenx-cli).
