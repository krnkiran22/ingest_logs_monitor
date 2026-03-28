import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const CANDIDATE_FILES = [
  ".env.example",
  ".env",
  ".env.local",
];

let loadedEnv: Record<string, string> | null = null;

function parseEnvFile(contents: string) {
  const parsed: Record<string, string> = {};

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function loadFallbackEnv() {
  if (loadedEnv) {
    return loadedEnv;
  }

  const collected: Record<string, string> = {};

  for (const filename of CANDIDATE_FILES) {
    const fullPath = path.resolve(process.cwd(), filename);
    if (!existsSync(fullPath)) {
      continue;
    }

    Object.assign(collected, parseEnvFile(readFileSync(fullPath, "utf8")));
  }

  loadedEnv = collected;
  return collected;
}

export function getEnv(key: string) {
  const direct = process.env[key]?.trim();
  if (direct) {
    return direct;
  }

  return loadFallbackEnv()[key]?.trim() ?? "";
}
