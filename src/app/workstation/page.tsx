"use client";

/**
 * GeraldOS Radiologist Workstation (/workstation)
 *
 * The operational heart of the platform (Phase 1). A single uninterrupted
 * workspace spanning: worklist (left) → viewer with hanging protocols (centre)
 * → clinical/AI/measurements/reporting (right) → timeline/events/audit (bottom).
 *
 * Layout: fixed panels with draggable splitters, persistent sizing in
 * localStorage, fullscreen mode, dense enterprise styling, keyboard shortcuts.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { WorkstationProvider, useWorkstation } from "@/components/workstation/workstation-context";
import { WorklistPanel } from "@/components/workstation/worklist-panel";
import { ViewerPanel } from "@/components/workstation/viewer-panel";
import { ClinicalPanel } from "@/components/workstation/clinical-panel";
import { ActivityPanel } from "@/components/workstation/activity-panel";
import { WorkstationCommandPalette } from "@/components/workstation/workstation-command-palette";
import Link from "next/link";
import {
  PanelLeft,
  PanelRight,
  PanelBottom,
  Maximize,
  Minimize,
  Keyboard,
  ChevronLeft,
  X,
  Command,
} from "lucide-react";
import { ClinicalHealthStrip } from "@/components/workstation/clinical-health-strip";

function WorkstationLayout() {
  const { layout, updateLayout, prevStudy, nextStudy, toggleBookmark, runAiReview, signReport, releaseStudy, fullscreen, toggleFullscreen } = useWorkstation();
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const leftDrag = useRef<{ startX: number; startW: number } | null>(null);
  const rightDrag = useRef<{ startX: number; startW: number } | null>(null);
  const bottomDrag = useRef<{ startY: number; startH: number } | null>(null);

  // ── Resizable splitters ──
  const startLeftDrag = (e: React.PointerEvent) => {
    leftDrag.current = { startX: e.clientX, startW: layout.leftWidth };
    const onMove = (ev: PointerEvent) => updateLayout({ leftWidth: Math.min(480, Math.max(240, leftDrag.current!.startW + (ev.clientX - leftDrag.current!.startX))) });
    const onUp = () => { leftDrag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startRightDrag = (e: React.PointerEvent) => {
    rightDrag.current = { startX: e.clientX, startW: layout.rightWidth };
    const onMove = (ev: PointerEvent) => updateLayout({ rightWidth: Math.min(520, Math.max(300, rightDrag.current!.startW + (rightDrag.current!.startX - ev.clientX))) });
    const onUp = () => { rightDrag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const startBottomDrag = (e: React.PointerEvent) => {
    bottomDrag.current = { startY: e.clientY, startH: layout.bottomHeight };
    const onMove = (ev: PointerEvent) => updateLayout({ bottomHeight: Math.min(420, Math.max(140, bottomDrag.current!.startH + (bottomDrag.current!.startY - ev.clientY))) });
    const onUp = () => { bottomDrag.current = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === "arrowleft") { e.preventDefault(); prevStudy(); }
      else if (k === "arrowright") { e.preventDefault(); nextStudy(); }
      else if (k === "b") { e.preventDefault(); toggleBookmark(); }
      else if (k === "a") { e.preventDefault(); runAiReview(); }
      else if (k === "enter") { e.preventDefault(); void signReport(); }
      else if (k === "r") { e.preventDefault(); releaseStudy(); }
      else if (k === "h") { setShowShortcuts((s) => !s); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prevStudy, nextStudy, toggleBookmark, runAiReview, signReport, releaseStudy]);

  // ── Custom events from the command palette ──
  useEffect(() => {
    const onToggleShortcuts = () => setShowShortcuts((s) => !s);
    window.addEventListener("workstation:toggle-shortcuts", onToggleShortcuts);
    return () => window.removeEventListener("workstation:toggle-shortcuts", onToggleShortcuts);
  }, []);

  // Intercept Ctrl+K only within the workstation (stop global palette from opening)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setShowPalette((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Top workspace bar — premium navy, restrained teal accent */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-[var(--color-gerald-navy)] px-3">
        <div className="flex items-center gap-2">
          <Link href="/" className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10 text-white transition-colors hover:bg-white/15" title="Back to Command Centre">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-md bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/gh-logo.png" alt="GH logo" className="h-5 w-5 object-contain" />
          </span>
          <span className="text-[12px] font-semibold tracking-tight text-white">Radiologist Workstation</span>
          <span className="hidden text-[10px] font-medium tracking-wide text-white/60 md:inline">GERALD HOLDINGS · Fluent in Imaging</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowPalette(true)} title="Command palette (Ctrl+K)" className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white">
            <Command className="h-3.5 w-3.5" />
            <kbd className="hidden rounded border border-white/20 bg-white/10 px-1 py-px font-mono text-[9px] text-white/70 lg:inline">⌘K</kbd>
          </button>
          <button onClick={() => setShowShortcuts((s) => !s)} title="Keyboard shortcuts (Alt+H)" className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
            <Keyboard className="h-4 w-4" />
          </button>
          <button onClick={() => updateLayout({ bottomOpen: !layout.bottomOpen })} title="Toggle bottom panel" className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
            <PanelBottom className="h-4 w-4" />
          </button>
          <button onClick={() => updateLayout({ leftWidth: layout.leftWidth > 0 ? 0 : 320 })} title="Toggle worklist" className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
            <PanelLeft className="h-4 w-4" />
          </button>
          <button onClick={() => updateLayout({ rightWidth: layout.rightWidth > 0 ? 0 : 380 })} title="Toggle clinical panel" className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
            <PanelRight className="h-4 w-4" />
          </button>
          <div className="mx-1 h-4 w-px bg-white/15" />
          <button onClick={toggleFullscreen} title="Fullscreen (F11)" className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white">
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Clinical stack health strip — compact, not dominant */}
      <div className="flex shrink-0 items-center justify-center border-b border-slate-200 bg-white px-3 py-1.5 dark:border-slate-800 dark:bg-slate-950">
        <ClinicalHealthStrip onOpenDrawer={() => window.dispatchEvent(new CustomEvent("workstation:open-health-drawer"))} />
      </div>

      {/* Main grid: left | centre | right */}
      <div className="flex min-h-0 flex-1">
        {/* Left: worklist */}
        {layout.leftWidth > 0 && (
          <div className="relative shrink-0 border-r border-slate-200 dark:border-slate-800" style={{ width: layout.leftWidth }}>
            <WorklistPanel />
            <div
              onPointerDown={startLeftDrag}
              className="absolute bottom-0 right-[-3px] top-0 z-30 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-brand/60"
              title="Drag to resize"
            />
          </div>
        )}

        {/* Centre: viewer */}
        <div className="relative min-w-0 flex-1">
          <ViewerPanel />
          {layout.rightWidth > 0 && (
            <div
              onPointerDown={startRightDrag}
              className="absolute bottom-0 right-[-3px] top-0 z-30 w-1.5 cursor-col-resize bg-transparent transition-colors hover:bg-brand/60"
              title="Drag to resize"
            />
          )}
        </div>

        {/* Right: clinical */}
        {layout.rightWidth > 0 && (
          <div className="relative shrink-0 border-l border-slate-200 dark:border-slate-800" style={{ width: layout.rightWidth }}>
            <ClinicalPanel />
          </div>
        )}
      </div>

      {/* Bottom: activity */}
      {layout.bottomOpen && (
        <div className="relative shrink-0 border-t border-slate-200 dark:border-slate-800" style={{ height: layout.bottomHeight }}>
          <ActivityPanel />
          <div
            onPointerDown={startBottomDrag}
            className="absolute left-0 right-0 top-[-3px] z-30 h-1.5 cursor-row-resize bg-transparent transition-colors hover:bg-brand/60"
            title="Drag to resize"
          />
        </div>
      )}

      {/* Command palette */}
      <WorkstationCommandPalette open={showPalette} onClose={() => setShowPalette(false)} />

      {/* Shortcuts overlay */}
      {showShortcuts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowShortcuts(false); }}
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Keyboard Shortcuts</p>
              <button onClick={() => setShowShortcuts(false)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
            </div>
            <div className="space-y-1.5">
              {[
                ["Alt + ← / →", "Previous / next study"],
                ["Alt + B", "Bookmark study"],
                ["Alt + A", "Run AI visual review"],
                ["Alt + C", "Toggle comparison mode"],
                ["Alt + Enter", "Sign report"],
                ["Alt + R", "Release study"],
                ["Alt + H", "Toggle this help"],
                ["Ctrl/Cmd + K", "Command palette"],
                ["Ctrl/Cmd + B", "Collapse sidebar"],
                ["F11", "Fullscreen workspace"],
              ].map(([k, d]) => (
                <div key={k} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5 dark:bg-slate-800">
                  <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-600 dark:border-slate-600 dark:text-slate-300">{k}</kbd>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">{d}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkstationPage() {
  return (
    <WorkstationProvider>
      <WorkstationLayout />
    </WorkstationProvider>
  );
}
