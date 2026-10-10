import { createRemoteJWKSet, jwtVerify } from "jose";

export type NeonAuthIdentity = { id: string };
export type NeonAuthVerifier = (token: string) => Promise<NeonAuthIdentity | null>;

export function createNeonAuthVerifier(baseUrl?: string, jwksUrl?: string): NeonAuthVerifier {
  if (!baseUrl) return async () => null;

  const authUrl = new URL(baseUrl);
  if (authUrl.protocol !== "https:" && authUrl.protocol !== "http:") {
    throw new Error("NEON_AUTH_BASE_URL must use http or https");
  }

  const issuer = authUrl.origin;
  const jwks = createRemoteJWKSet(
    new URL(jwksUrl ?? `${baseUrl.replace(/\/+$/, "")}/.well-known/jwks.json`),
  );

  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer, audience: issuer });
      if (typeof payload.sub !== "string" || !payload.sub.trim() || payload.sub.length > 255) return null;
      return { id: payload.sub };
    } catch {
      return null;
    }
  };
}
