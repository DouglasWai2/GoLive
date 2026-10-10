export class NeonAuthTokenError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "NeonAuthTokenError";
  }
}

export type NeonAuthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function fetchNeonAuthToken(
  authBaseUrl: string,
  fetcher: NeonAuthFetch = fetch,
): Promise<string> {
  const url = new URL(authBaseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/token`;
  url.search = "";
  url.hash = "";

  const response = await fetcher(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  let payload: { token?: unknown; message?: unknown; error?: unknown } | null = null;
  try {
    payload = await response.json() as { token?: unknown; message?: unknown; error?: unknown };
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "string" ? payload.error : response.statusText;
    const message = response.status === 401
      ? "Your Neon Auth session is unavailable. Sign in with Google again."
      : `Neon Auth could not issue an access token (${response.status})${detail ? `: ${detail}` : ""}`;
    throw new NeonAuthTokenError(response.status, message);
  }

  if (typeof payload?.token !== "string" || !payload.token) {
    throw new NeonAuthTokenError(502, "Neon Auth returned no access token. Check that this branch has JWT auth enabled.");
  }
  return payload.token;
}
