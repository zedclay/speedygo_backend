export type ChargilyHttpRequest = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
};

export type ChargilyHttpResponse = {
  status: number;
  json: unknown;
};

export interface ChargilyHttpClient {
  request(input: ChargilyHttpRequest): Promise<ChargilyHttpResponse>;
}

export type FetchChargilyHttpConfig = {
  baseUrl: string;
  secretKey: string;
  timeoutMs: number;
};

export class FetchChargilyHttpClient implements ChargilyHttpClient {
  constructor(private readonly config: FetchChargilyHttpConfig) {}

  async request(input: ChargilyHttpRequest): Promise<ChargilyHttpResponse> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${input.path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(url, {
        method: input.method,
        headers: {
          Authorization: `Bearer ${this.config.secretKey}`,
          Accept: 'application/json',
          ...(input.body !== undefined
            ? { 'Content-Type': 'application/json' }
            : {}),
        },
        body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      });
      const json: unknown = await response.json().catch(() => null);
      return { status: response.status, json };
    } finally {
      clearTimeout(timer);
    }
  }
}
