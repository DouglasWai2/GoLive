export const env = {
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
}
