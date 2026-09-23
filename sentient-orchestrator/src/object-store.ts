export interface ObjectStore {
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export class RemoteObjectStore implements ObjectStore {
  constructor(
    private readonly baseUrl: string,
    private readonly serviceToken: string,
    private readonly timeoutMs = 30_000,
  ) {}

  async put(
    key: string,
    data: Uint8Array,
    contentType = "application/octet-stream",
  ): Promise<void> {
    const response = await this.request(key, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: data,
    });
    if (!response.ok) throw new Error(`Object store put failed: ${response.status}`);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.request(key, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Object store get failed: ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const response = await this.request(key, { method: "DELETE" });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Object store delete failed: ${response.status}`);
    }
  }

  private async request(key: string, init: RequestInit): Promise<Response> {
    validateObjectKey(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/objects/${encodeURIComponent(key)}`,
        {
          ...init,
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${this.serviceToken}`,
            ...(init.headers ?? {}),
          },
        },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export function validateObjectKey(key: string): string {
  if (
    !key ||
    key.length > 2048 ||
    key.startsWith("/") ||
    key.includes("..") ||
    key.includes("\\") ||
    key.includes("\0")
  ) {
    throw new Error("Invalid object key");
  }
  return key;
}
