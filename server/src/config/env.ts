export const env = {
  get trustProxy(): boolean | string[] | ((address: string, hop: number) => boolean) {
    const value = process.env.TRUST_PROXY?.trim();
    if (!value) return false;
    if (/^\d+$/.test(value)) {
      const trustedHops = Number(value);
      if (!Number.isSafeInteger(trustedHops) || trustedHops < 1 || trustedHops > 10) return false;
      return (_address, hop) => hop < trustedHops;
    }
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
    const proxies = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    return proxies.length ? proxies : false;
  },

  get maxRoomsPerDevice(): number {
    const value = Number(process.env.MAX_ROOMS_PER_DEVICE ?? 100);
    return Number.isInteger(value) && value > 0 ? value : 100;
  },

  get maxMembersPerRoom(): number {
    const value = Number(process.env.MAX_MEMBERS_PER_ROOM ?? 1000);
    return Number.isInteger(value) && value > 0 ? value : 1000;
  },

  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },

  get host(): string {
    return process.env.HOST ?? "0.0.0.0";
  },

  get origin(): string | undefined {
    return process.env.ORIGIN ?? "http://localhost:3000";
  },

  get turnKeyId(): string | undefined {
    return process.env.CLOUDFLARE_TURN_KEY_ID;
  },

  get turnApiToken(): string | undefined {
    return process.env.CLOUDFLARE_TURN_API_TOKEN;
  },

  get cloudflareAccountId(): string | undefined {
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  },

  get cloudflareAnalyticsApiToken(): string | undefined {
    return process.env.CLOUDFLARE_ANALYTICS_API_TOKEN;
  },

  get cloudflareTurnSwitchGB(): number {
    const value = Number(process.env.CLOUDFLARE_TURN_SWITCH_GB ?? 950);
    return Number.isFinite(value) && value >= 0 ? value : 950;
  },

  get expressTurnUrls(): string[] {
    return (process.env.EXPRESSTURN_URLS ?? "")
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
  },

  get expressTurnUsername(): string | undefined {
    return process.env.EXPRESSTURN_USERNAME;
  },

  get expressTurnCredential(): string | undefined {
    return process.env.EXPRESSTURN_CREDENTIAL;
  },

  get expressTurnDisabled(): boolean {
    return ["1", "true", "yes"].includes(
      (process.env.EXPRESSTURN_DISABLED ?? "").toLowerCase(),
    );
  },

  get jwtSecret(): string | undefined {
    return process.env.JWT_SECRET;
  },

  get adminSecret(): string | undefined {
    return process.env.ADMIN_SECRET;
  },

  get databaseUrl(): string | undefined {
    return process.env.DATABASE_URL;
  },

  get neonAuthBaseUrl(): string | undefined {
    return process.env.NEON_AUTH_BASE_URL;
  },

  get googleAuthEnabled(): boolean {
    const configured = process.env.GOOGLE_AUTH_ENABLED?.trim().toLowerCase();
    return configured === undefined ? process.env.NODE_ENV !== "production" : configured === "true";
  },

  get neonAuthJwksUrl(): string | undefined {
    return process.env.NEON_AUTH_JWKS_URL;
  },
}
