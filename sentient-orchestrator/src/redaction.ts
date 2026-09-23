const TOKEN_PATTERNS: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:Bearer|token)\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
];

export class SecretRedactor {
  private readonly variants = new Map<string, number>();

  register(secret: string): void {
    if (!secret || secret.length < 4) return;
    for (const variant of secretVariants(secret)) {
      if (variant.length < 4) continue;
      this.variants.set(variant, (this.variants.get(variant) ?? 0) + 1);
    }
  }

  unregister(secret: string): void {
    for (const variant of secretVariants(secret)) {
      const count = this.variants.get(variant);
      if (!count) continue;
      if (count <= 1) this.variants.delete(variant);
      else this.variants.set(variant, count - 1);
    }
  }

  redact(text: string): string {
    let output = text;
    const variants = [...this.variants.keys()].sort((a, b) => b.length - a.length);
    for (const variant of variants) {
      output = replaceAllLiteral(output, variant, "[REDACTED]");
    }
    for (const pattern of TOKEN_PATTERNS) {
      output = output.replace(pattern, "[REDACTED]");
    }
    return output;
  }

  redactValue<T>(value: T): T {
    return redactUnknown(value, (text) => this.redact(text)) as T;
  }
}

export function redactCredentialShapes(text: string): string {
  let output = text;
  for (const pattern of TOKEN_PATTERNS) output = output.replace(pattern, "[REDACTED]");
  return output;
}

function secretVariants(secret: string): string[] {
  const encoded = Buffer.from(secret, "utf8");
  return [
    secret,
    encodeURIComponent(secret),
    encoded.toString("base64"),
    encoded.toString("base64url"),
  ];
}

function replaceAllLiteral(text: string, needle: string, replacement: string): string {
  if (!needle || !text.includes(needle)) return text;
  return text.split(needle).join(replacement);
}

function redactUnknown(
  value: unknown,
  redact: (text: string) => string,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redact(value);
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactUnknown(item, redact, seen));

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = redactUnknown(item, redact, seen);
  }
  return output;
}
