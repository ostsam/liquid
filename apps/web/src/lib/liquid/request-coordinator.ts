type PendingChangeHandler = (isPending: boolean) => void;
type ErrorHandler = (error: unknown) => void;

export interface CoordinatorContext {
  requestId: number;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
}

export interface LiquidRequestCoordinatorOptions<TPayload, TResult> {
  delayMs: number;
  execute: (payload: TPayload, context: CoordinatorContext) => Promise<TResult>;
  onPendingChange?: PendingChangeHandler;
  onChunk?: (chunk: string, requestId: number) => void;
  onCommit: (result: TResult, requestId: number) => void | Promise<void>;
  onError?: ErrorHandler;
}

function isAbortLike(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : error instanceof Error && error.name === "AbortError"
  );
}

export class LiquidRequestCoordinator<TPayload, TResult = string> {
  private delayMs: number;
  private execute: LiquidRequestCoordinatorOptions<TPayload, TResult>["execute"];
  private onPendingChange?: PendingChangeHandler;
  private onChunk?: (chunk: string, requestId: number) => void;
  private onCommit: LiquidRequestCoordinatorOptions<TPayload, TResult>["onCommit"];
  private onError?: ErrorHandler;

  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private nextRequestId = 0;
  private latestRequestId = 0;

  constructor(options: LiquidRequestCoordinatorOptions<TPayload, TResult>) {
    this.delayMs = options.delayMs;
    this.execute = options.execute;
    this.onPendingChange = options.onPendingChange;
    this.onChunk = options.onChunk;
    this.onCommit = options.onCommit;
    this.onError = options.onError;
  }

  schedule(payload: TPayload) {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.onPendingChange?.(true);
    this.timer = setTimeout(() => {
      void this.start(payload);
    }, this.delayMs);
  }

  runNow(payload: TPayload) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    return this.start(payload);
  }

  cancel() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.controller) {
      this.controller.abort();
      this.controller = null;
    }

    this.onPendingChange?.(false);
  }

  dispose() {
    this.cancel();
  }

  private async start(payload: TPayload) {
    if (this.controller) {
      this.controller.abort();
    }

    const controller = new AbortController();
    const requestId = ++this.nextRequestId;
    this.latestRequestId = requestId;
    this.controller = controller;
    this.onPendingChange?.(true);

    try {
      const result = await this.execute(payload, {
        requestId,
        signal: controller.signal,
        onChunk: (chunk) => {
          if (controller.signal.aborted || this.latestRequestId !== requestId) {
            return;
          }

          this.onChunk?.(chunk, requestId);
        },
      });

      if (controller.signal.aborted || this.latestRequestId !== requestId) {
        return;
      }

      await this.onCommit(result, requestId);
    } catch (error) {
      if (controller.signal.aborted || isAbortLike(error)) {
        return;
      }

      if (this.latestRequestId !== requestId) {
        return;
      }

      this.onError?.(error);
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }

      if (this.latestRequestId === requestId) {
        this.onPendingChange?.(false);
      }
    }
  }
}
