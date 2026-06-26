import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.js";
import { getRedisClient, isRedisEnabled, pingRedis } from "./redis.js";

const DATA_DIR = process.env.DATA_DIR || ".data";

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function diskPath(key: string): string {
  ensureDataDir();
  return join(DATA_DIR, `${key}.json`);
}

export async function loadState<T>(key: string, fallback: T): Promise<T> {
  if (isRedisEnabled() && (await pingRedis())) {
    try {
      const client = getRedisClient();
      const raw = await client.get(`state:${key}`);
      if (raw) return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err, key }, "Redis state load failed, falling back to disk");
    }
  }
  try {
    const path = diskPath(key);
    if (!existsSync(path)) return fallback;
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, key }, "Disk state load failed");
    return fallback;
  }
}

export async function saveState<T>(key: string, value: T): Promise<void> {
  const raw = JSON.stringify(value);
  let redisSaved = false;
  if (isRedisEnabled() && (await pingRedis())) {
    try {
      await getRedisClient().set(`state:${key}`, raw);
      redisSaved = true;
    } catch (err) {
      logger.warn({ err, key }, "Redis state save failed");
    }
  }
  try {
    writeFileSync(diskPath(key), raw);
  } catch (err) {
    if (!redisSaved) {
      logger.error({ err, key }, "Failed to save state to disk or redis");
      throw err;
    }
    logger.warn({ err, key }, "Disk state save failed, but redis succeeded");
  }
}
