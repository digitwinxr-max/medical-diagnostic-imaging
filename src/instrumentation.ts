export async function register() {
  if (typeof window === "undefined") {
    try {
      const { startReconcilerPoll } = await import("./lib/reconciler-poll");
      startReconcilerPoll();
    } catch (err) {
      console.warn("[instrumentation] reconciler poll not started:", err instanceof Error ? err.message : String(err));
    }
  }
}
