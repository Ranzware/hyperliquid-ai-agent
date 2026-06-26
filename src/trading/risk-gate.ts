import { settings } from "../config/settings.js";
import { logger } from "../config/logger.js";
import type { ActiveTrade, RiskCheck, UserState } from "../types/index.js";

export interface RiskContext {
  userState: UserState;
  activeTrades: ActiveTrade[];
  dailyPnl: number;
  asset: string;
  proposedAllocationUsd: number;
  action: "buy" | "sell" | "hold";
}

export function evaluateRisk(ctx: RiskContext): RiskCheck {
  const { userState, activeTrades, dailyPnl, asset, proposedAllocationUsd: rawAlloc, action } = ctx;
  let proposedAllocationUsd = rawAlloc;

  if (settings.dailyLossHaltPct > 0) {
    const dailyLossPct = userState.total_value ? (Math.min(0, dailyPnl) / userState.total_value) * 100 : 0;
    if (dailyLossPct <= -settings.dailyLossHaltPct) {
      return { allowed: false, reason: `Daily loss halt triggered (${dailyLossPct.toFixed(2)}%)` };
    }
  }

  if (action === "hold" || proposedAllocationUsd <= 0) {
    return { allowed: true };
  }

  if (!userState.total_value || userState.total_value <= 0) {
    return { allowed: false, reason: "Account value unavailable" };
  }

  const freeCollateral = userState.total_value - Math.abs(
    userState.positions.reduce((sum, p) => sum + Math.abs(p.szi * p.entryPx), 0)
  );
  const minFree = userState.total_value * (settings.minFreeCollateralPct / 100);
  if (freeCollateral - proposedAllocationUsd < minFree) {
    const scaled = Math.max(0, freeCollateral - minFree);
    if (scaled <= 0) {
      return { allowed: false, reason: "Insufficient free collateral" };
    }
    proposedAllocationUsd = scaled;
  }

  const maxAllocation = userState.total_value * (settings.maxAllocationPct / 100);
  if (proposedAllocationUsd > maxAllocation) {
    proposedAllocationUsd = maxAllocation;
  }

  const openPositions = new Set(activeTrades.map((t) => t.asset));
  if (openPositions.size >= settings.maxPositions && !openPositions.has(asset)) {
    return { allowed: false, reason: `Max positions (${settings.maxPositions}) reached` };
  }

  const sameAssetExposure = activeTrades
    .filter((t) => t.asset === asset)
    .reduce((sum, t) => sum + t.amount * t.entry_price, 0);
  const assetLimit = userState.total_value * (settings.maxAllocationPct / 100);
  if (sameAssetExposure + proposedAllocationUsd > assetLimit) {
    proposedAllocationUsd = Math.max(0, assetLimit - sameAssetExposure);
    if (proposedAllocationUsd <= 0) {
      return { allowed: false, reason: `Asset exposure limit for ${asset}` };
    }
  }

  logger.info(
    { asset, original: ctx.proposedAllocationUsd, scaled: proposedAllocationUsd },
    "Risk gate passed"
  );
  return { allowed: true, scaledAllocationUsd: proposedAllocationUsd };
}
