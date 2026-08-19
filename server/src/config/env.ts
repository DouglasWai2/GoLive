export const env = {
  get port(): number {
    return Number(process.env.PORT ?? 3000);
  },

  get host(): string {
    return process.env.HOST ?? "0.0.0.0";
  },

  get origin(): string | undefined {
    return process.env.ORIGIN;
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
};