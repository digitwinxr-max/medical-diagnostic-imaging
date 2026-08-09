/**
 * Reconciler auto-poll — single-instance interval that calls reconcileOnce.
 * Started via instrumentation.ts register() on server boot.
 * Disabled when ORTHANC_URL absent or GERALDOS_RECONCILER_POLL=0.
 */
import { reconcileOnce } from "./orthanc-reconciler";

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startReconcilerPoll(intervalMs = 5_000) {
  if (timer) return; // already started (HMR-safe)
  if (process.env.GERALDOS_RECONCILER_POLL === "0") return;
  if (!process.env.ORTHANC_URL) return;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const res = await reconcileOnce({ limit: 50 });
      if (res.created > 0 || res.updated > 0 || res.failed > 0) {
        console.log(`[reconciler] tick cursor=${res.cursor}→${res.nextCursor} created=${res.created} updated=${res.updated} failed=${res.failed} skipped=${res.skipped}`);
      }
    } catch (e) {
      // Orthanc not ready or transient — warn but keep polling
      console.warn("[reconciler] tick failed", e instanceof Error ? e.message : String(e));
    } finally {
      running = false;
    }
  };

  // initial delay 5s then interval
  const initial = setTimeout(() => {
    tick();
    timer = setInterval(tick, intervalMs);
  }, 5_000);
  // allow node to exit without waiting for timers in tests
  if (typeof (initial as unknown as { unref?: () => void }).unref === "function") {
    (initial as unknown as { unref: () => void }).unref!();
  }
}

export function stopReconcilerPoll() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
