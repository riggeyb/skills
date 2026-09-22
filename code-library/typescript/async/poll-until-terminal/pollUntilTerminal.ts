export interface PollTerminalOptions<T> {
  observe: () => Promise<T>;
  isTerminal: (value: T) => boolean;
  intervalMs: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

function abortError(): Error {
  const error = new Error("Polling aborted");
  error.name = "AbortError";
  return error;
}

export async function pollUntilTerminal<T>({
  observe, isTerminal, intervalMs, timeoutMs, signal,
}: PollTerminalOptions<T>): Promise<T> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new RangeError("intervalMs must be positive");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("timeoutMs must be positive");

  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (signal?.aborted) throw abortError();
    const value = await observe();
    if (isTerminal(value)) return value;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error(`Polling timed out after ${timeoutMs}ms`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(intervalMs, remainingMs));
      if (!signal) return;
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }
}
