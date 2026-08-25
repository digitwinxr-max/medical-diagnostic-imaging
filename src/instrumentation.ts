export async function register() {
  if (
    typeof window === "undefined" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    try {
      const { startReconcilerPoll } = await import("./lib/reconciler-poll");
      startReconcilerPoll();
    } catch (err) {
      console.warn("[instrumentation] reconciler poll not started:", err instanceof Error ? err.message : String(err));
    }
  }
}

