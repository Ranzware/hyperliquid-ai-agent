import { Hono } from "hono";
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { settings } from "../config/settings.js";

const LOG_DIR = settings.logDir;
const DIARY_PATH = `${LOG_DIR}/diary.jsonl`;

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function safeLogPath(raw: string): string | null {
  ensureLogDir();
  const name = basename(raw);
  if (!name || name.startsWith(".") || extname(name) !== ".log") return null;
  const allowed = new Set(readdirSync(LOG_DIR).filter((f) => f.endsWith(".log")));
  if (!allowed.has(name)) return null;
  return resolve(join(LOG_DIR, name));
}

export function createApiApp(): Hono {
  ensureLogDir();
  const app = new Hono();

  app.get("/diary", (c) => {
    try {
      const raw = c.req.query("raw");
      const download = c.req.query("download");
      if (raw || download) {
        if (!existsSync(DIARY_PATH)) return c.text("");
        const data = readFileSync(DIARY_PATH, "utf8");
        if (download) {
          c.header("Content-Disposition", "attachment; filename=diary.jsonl");
        }
        return c.text(data);
      }
      const limit = Number(c.req.query("limit") ?? "200");
      if (!existsSync(DIARY_PATH)) return c.json({ entries: [] });
      const lines = readFileSync(DIARY_PATH, "utf8").split("\n").filter(Boolean);
      const entries = lines.slice(Math.max(0, lines.length - limit)).map((line) => JSON.parse(line));
      return c.json({ entries });
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  app.get("/logs", (c) => {
    try {
      const path = c.req.query("path") ?? "llm_requests.log";
      const download = c.req.query("download");
      const limitParam = c.req.query("limit");
      const safePath = safeLogPath(path);
      if (!safePath) return c.json({ error: "Invalid or disallowed log file" }, 400);
      const data = readFileSync(safePath, "utf8");
      if (download || limitParam?.toLowerCase() === "all" || limitParam === "-1") {
        if (download) {
          c.header("Content-Disposition", `attachment; filename=${basename(safePath)}`);
        }
        return c.text(data);
      }
      const limit = limitParam ? Number(limitParam) : 2000;
      return c.text(data.slice(-limit));
    } catch (err) {
      return c.json({ error: String(err) }, 500);
    }
  });

  app.get("/health", (c) => c.json({ status: "ok", provider: settings.llmProvider }));

  return app;
}
