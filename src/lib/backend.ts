import { getEnv } from "@/lib/env";
import { parseJsonResponse } from "@/lib/http";

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getBackendBaseUrl() {
  return trimTrailingSlash(getEnv("INGEST_BACKEND_BASE_URL"));
}

export function hasExternalBackend() {
  return Boolean(getBackendBaseUrl());
}

export async function fetchBackendJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const baseUrl = getBackendBaseUrl();
  if (!baseUrl) {
    throw new Error("INGEST_BACKEND_BASE_URL is not configured.");
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    cache: "no-store",
  });

  return parseJsonResponse<T>(
    response,
    `Backend response for ${path} was empty.`,
  );
}
