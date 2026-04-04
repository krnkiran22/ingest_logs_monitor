function trimSnippet(value: string, maxLength = 240) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 3)}...`;
}

function getPayloadError(payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string" &&
    payload.error.trim()
  ) {
    return payload.error.trim();
  }

  return null;
}

async function readResponseBody(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return { text, payload: null as unknown };
  }

  try {
    return { text, payload: JSON.parse(text) as unknown };
  } catch {
    return { text, payload: null as unknown };
  }
}

export async function parseJsonResponse<T>(
  response: Response,
  emptyBodyMessage = "Response body was empty.",
): Promise<T> {
  const { text, payload } = await readResponseBody(response);

  if (!response.ok) {
    throw new Error(
      getPayloadError(payload) ||
        (text.trim() ? trimSnippet(text) : `${response.status} ${response.statusText}`),
    );
  }

  if (payload === null) {
    throw new Error(text.trim() ? `Expected JSON response but received: ${trimSnippet(text)}` : emptyBodyMessage);
  }

  return payload as T;
}
