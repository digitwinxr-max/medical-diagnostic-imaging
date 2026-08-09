export async function register() {
  // Next.js instrumentation — called once on server boot (both dev & prod)
  // Start reconciler auto-poll in Node runtime only
  if (typeof window === "undefined") {
    const { startReconcilerPoll } = await import("./lib/reconciler-poll");
    startReconcilerPoll();
  }
}
