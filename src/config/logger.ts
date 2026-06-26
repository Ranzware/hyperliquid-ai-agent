import pino from "pino";
import { existsSync, mkdirSync } from "node:fs";
import { settings } from "./settings.js";

if (!existsSync(settings.logDir)) mkdirSync(settings.logDir, { recursive: true });

const targets: pino.TransportTargetOptions[] = [
  {
    target: "pino-pretty",
    options: { colorize: true },
    level: settings.logLevel,
  },
];

if (process.env.NODE_ENV === "production" || process.env.LOG_TO_FILE === "true") {
  targets.push({
    target: "pino/file",
    options: { destination: `${settings.logDir}/app.log` },
    level: settings.logLevel,
  });
}

export const logger = pino({
  level: settings.logLevel,
  transport: { targets },
});
