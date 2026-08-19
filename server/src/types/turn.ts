export type CloudflareGraphQlResponse = {
  data?: {
    viewer?: {
      accounts?: Array<{
        callsTurnUsageAdaptiveGroups?: Array<{
          sum?: {
            egressBytes?: number;
            ingressBytes?: number;
          };
        }>;
      }>;
    };
  };
  errors?: Array<{
    message: string;
  }>;
};

export type CloudflareTurnUsage = {
  from: string;
  to: string;

  egressBytes: number;
  ingressBytes: number;

  egressGB: number;
  ingressGB: number;

  freeTierPercent: number;
};