import { getEnv } from "@/lib/env";

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

  const payload = (await response.json().catch(() => null)) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }

  return payload as T;
}
