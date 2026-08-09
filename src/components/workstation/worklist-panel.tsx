"use client";

import React, { useMemo, useState } from "react";
import { useWorkstation, VIEWS, type WorklistView, type WorklistEntry } from "./workstation-context";
import { cn } from "@/lib/utils";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./context-menu";
import {
  Search,
  ListFilter,
  Bookmark,
  Star,
  ChevronRight,
  Loader2,
  Inbox,
  AlertTriangle,
  Siren,
  UserCheck,
  CheckCircle2,
  LayoutList,
  SlidersHorizontal,
  Clock,
  ScanLine,
  Hospital,
  Stethoscope,
  Cpu,
  Eye,
  ExternalLink,
  Copy,
  Flag,
  Upload,
  CheckCircle,
  XCircle,
} from "lucide-react";

const VIEW_META: Record<WorklistView, { label: string; icon: React.ElementType; tone: string }> = {
  today: { label: "Today's Studies", icon: Clock, tone: "text-brand" },
  unread: { label: "Unread Studies", icon: Inbox, tone: "text-ai" },
  stat: { label: "STAT Cases", icon: Siren, tone: "text-red-500" },
  emergency: { label: "Emergency", icon: AlertTriangle, tone: "text-amber-500" },
  assigned: { label: "Assigned to Me", icon: UserCheck, tone: "text-operational" },
  completed: { label: "Completed", icon: CheckCircle2, tone: "text-operational" },
  all: { label: "All Studies", icon: LayoutList, tone: "text-slate-400" },
};

const PRIORITY_STYLE: Record<string, string> = {
  emergency: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  stat: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  urgent: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  routine: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const STAGE_LABEL: Record<string, string> = {
  referral: "Referral",
  appointment: "Appointment",
  arrival: "Arrival",
  study_created: "Study Created",
  sent_to_orthanc: "In PACS",
  assigned: "Assigned",
  opened: "Opened",
  review: "AI Review",
  report_draft: "Report Draft",
  signed: "Signed",
  released: "Released",
  archived: "Archived",
};

const STAGE_STYLE: Record<string, string> = {
  referral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  appointment: "bg-brand-soft text-brand-text",
  arrival: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300",
  study_created: "bg-brand-soft text-brand-text",
  sent_to_orthanc: "bg-brand-soft text-brand-text",
  assigned: "bg-ai-soft text-ai-text",
  opened: "bg-ai-soft text-ai-text",
  review: "bg-ai-soft text-ai-text",
  report_draft: "bg-premium-soft text-premium-text",
  signed: "bg-operational-soft text-operational-text",
  released: "bg-operational-soft text-operational-text",
  archived: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-500",
};

export function WorklistPanel() {
  const {
    entries, allEntries, facets, view, setView, filters, setFilters, worklistLoading, refreshWorklist,
    selected, openStudy,
  } = useWorkstation();
  const [showFilters, setShowFilters] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadDrag, setUploadDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);
  const { menu, onContextMenu, close } = useContextMenu();

  const counts = useMemo(() => {
    const c: Partial<Record<WorklistView, number>> = {};
    const all = allEntries;
    c.all = all.length;
    c.today = all.filter((e) => new Date(e.createdAt).toDateString() === new Date().toDateString()).length;
    c.unread = all.filter((e) => e.stage === "referral").length;
    c.stat = all.filter((e) => e.priority?.toLowerCase() === "stat").length;
    c.emergency = all.filter((e) => e.priority?.toLowerCase() === "emergency").length;
    c.assigned = all.filter((e) => e.radiologistId).length;
    c.completed = all.filter((e) => ["completed", "released", "archived"].includes(e.stage)).length;
    return c;
  }, [allEntries]);

  const entrySubtitle = (e: WorklistEntry) => {
    const parts: string[] = [];
    if (e.machineName) parts.push(e.machineName);
    if (e.referringPhysician) parts.push(e.referringPhysician);
    if (e.scheduledTime) parts.push(e.scheduledTime);
    return parts.join(" · ");
  };

  const buildContextMenu = (e: WorklistEntry): ContextMenuItem[] => {
    const isActive = selected?.id === e.id;
    const items: ContextMenuItem[] = [
      {
        label: isActive ? "Reload study" : "Open study",
        icon: Eye,
        action: () => openStudy(e),
      },
      {
        label: "Open in new tab",
        icon: ExternalLink,
        action: () => window.open(`/workstation?studyId=${e.id}`, "_blank"),
      },
      { label: "", action: () => {}, divider: true },
      {
        label: "Bookmark",
        icon: Bookmark,
        action: async () => {
          await fetch("/api/bookmarks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              studyId: e.id,
              label: `${e.procedure} — ${e.patientLastName ?? ""}`.trim(),
              userId: "radiologist",
            }),
          });
        },
      },
      {
        label: "Copy accession number",
        icon: Copy,
        action: () => navigator.clipboard.writeText(e.accessionNumber ?? ""),
      },
      { label: "", action: () => {}, divider: true },
      {
        label: "Flag as urgent",
        icon: Flag,
        action: async () => {
          await fetch(`/api/workflow/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ priority: "stat" }),
          });
          refreshWorklist();
        },
        disabled: e.priority === "stat" || e.priority === "emergency",
      },
      {
        label: "Assign to radiologist",
        icon: UserCheck,
        action: async () => {
          const radio = facets?.radiologists?.[0];
          if (!radio) return;
          await fetch(`/api/workflow/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "assign", radiologistId: radio.id, changedBy: "radiologist" }),
          });
          refreshWorklist();
        },
        disabled: ["released", "archived"].includes(e.stage) || !facets?.radiologists?.length,
      },
      {
        label: "Release study",
        icon: CheckCircle2,
        action: async () => {
          await fetch(`/api/workflow/${e.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "transition", to: "released", changedBy: "radiologist" }),
          });
          refreshWorklist();
        },
        // Only a study whose report has been signed can be released.
        disabled: e.stage !== "signed",
      },
    ];
    return items;
  };

  const handleUpload = async (files: FileList | File[]) => {
    if (!files.length) return;
    setUploading(true);
    setUploadResult(null);
    try {
      const formData = new FormData();
      for (const file of Array.from(files)) {
        formData.append("file", file);
      }
      const res = await fetch("/api/orthanc/upload", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        const count = data.count ?? files.length;
        setUploadResult(`Uploaded ${count} DICOM file(s) successfully`);
        refreshWorklist();
      } else {
        const err = await res.json().catch(() => ({ error: "Upload failed" }));
        setUploadResult(err.error ?? "Upload failed");
      }
    } catch (e) {
      setUploadResult(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white dark:bg-slate-950">
      {/* Header */}
      <div className="border-b border-slate-200 px-3 py-2.5 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-hover text-[10px] font-bold text-white">WL</div>
            <div>
              <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100">Radiology Worklist</p>
              <p className="text-[10px] text-slate-400">{entries.length} studies · live</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowUpload((s) => !s)}
              title="Upload DICOM studies"
              className={cn(
                "rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand dark:hover:bg-slate-800",
                showUpload && "bg-brand-soft text-brand"
              )}
            >
              <Upload className="h-4 w-4" />
            </button>
            <button
              onClick={() => setShowBookmarks((s) => !s)}
              title="Bookmarks"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-amber-500 dark:hover:bg-slate-800"
            >
              <Star className={cn("h-4 w-4", showBookmarks && "fill-amber-400 text-amber-500")} />
            </button>
            <button
              onClick={refreshWorklist}
              title="Refresh worklist"
              className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            >
              <Loader2 className={cn("h-4 w-4", worklistLoading && "animate-spin text-brand")} />
            </button>
          </div>
        </div>

        {/* Upload dropzone */}
        {showUpload && (
          <div className="mt-2">
            <div
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDrag(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDrag(false); }}
              onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setUploadDrag(false); handleUpload(e.dataTransfer.files); }}
              className={cn(
                "relative flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-3 py-3 transition-colors",
                uploadDrag
                  ? "border-brand bg-brand-soft/60"
                  : "border-slate-200 bg-slate-50 hover:border-brand/60 hover:bg-brand-soft/40 dark:border-slate-700 dark:bg-slate-900"
              )}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-brand" />
                  <p className="text-[10px] text-slate-500">Uploading…</p>
                </>
              ) : uploadResult ? (
                <>
                  {uploadResult.startsWith("Uploaded") ? (
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <p className={cn("text-[10px]", uploadResult.startsWith("Uploaded") ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
                    {uploadResult}
                  </p>
                  <button onClick={() => setUploadResult(null)} className="text-[9px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">Dismiss</button>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-slate-400" />
                  <p className="text-[10px] text-slate-500">Drag DICOM files here or click to browse</p>
                  <input
                    type="file"
                    multiple
                    accept=".dcm,.dicom,application/dicom"
                    onChange={(e) => e.target.files && handleUpload(e.target.files)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {showBookmarks ? (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      ) : (
        <>
          {/* Views */}
          <div className="border-b border-slate-200 px-2 py-2 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-1">
              {VIEWS.map((v) => {
                const meta = VIEW_META[v];
                return (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-medium transition-colors",
                      view === v
                        ? "bg-brand-soft text-brand-text"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900"
                    )}
                  >
                    <meta.icon className={cn("h-3.5 w-3.5 flex-shrink-0", view === v ? meta.tone : "text-slate-400")} />
                    <span className="flex-1 truncate">{meta.label}</span>
                    <span className="text-[10px] text-slate-400">{counts[v] ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search */}
          <div className="border-b border-slate-200 p-2 dark:border-slate-800">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.q}
                onChange={(e) => setFilters({ q: e.target.value })}
                placeholder="Search patient, MRN, accession…"
                className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-8 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-brand focus:bg-white dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand dark:focus:bg-slate-800"
              />
              <button
                onClick={() => setShowFilters((s) => !s)}
                title="Advanced filters"
                className={cn(
                  "absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 transition-colors",
                  showFilters ? "bg-brand-soft text-brand" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                )}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>

            {showFilters && facets && (
              <div className="mt-2 space-y-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
                <FilterRow label="Modality" icon={ScanLine}>
                  <select
                    value={filters.modality}
                    onChange={(e) => setFilters({ modality: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All modalities</option>
                    {["CT", "X-Ray", "MRI", "Ultrasound", "Mammography", "DEXA", "Fluoroscopy"].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </FilterRow>
                <FilterRow label="Machine" icon={Cpu}>
                  <select
                    value={filters.machine}
                    onChange={(e) => setFilters({ machine: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All machines</option>
                    {facets.machines.map((m) => m.name && <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </FilterRow>
                <FilterRow label="Radiologist" icon={Stethoscope}>
                  <select
                    value={filters.radiologist}
                    onChange={(e) => setFilters({ radiologist: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All radiologists</option>
                    {facets.radiologists.map((r) => (
                      <option key={r.id} value={`${r.firstName} ${r.lastName}`}>{r.firstName} {r.lastName}</option>
                    ))}
                  </select>
                </FilterRow>
                <FilterRow label="Physician" icon={Stethoscope}>
                  <select
                    value={filters.physician}
                    onChange={(e) => setFilters({ physician: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All physicians</option>
                    {facets.physicians.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </FilterRow>
                <FilterRow label="Location" icon={Hospital}>
                  <select
                    value={filters.location}
                    onChange={(e) => setFilters({ location: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All locations</option>
                    {facets.locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </FilterRow>
                <FilterRow label="Priority" icon={AlertTriangle}>
                  <select
                    value={filters.priority}
                    onChange={(e) => setFilters({ priority: e.target.value })}
                    className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <option value="">All priorities</option>
                    <option value="emergency">Emergency</option>
                    <option value="stat">STAT</option>
                    <option value="urgent">Urgent</option>
                    <option value="routine">Routine</option>
                  </select>
                </FilterRow>
                <button
                  onClick={() => setFilters({ q: "", modality: "", radiologist: "", machine: "", physician: "", location: "", priority: "" })}
                  className="w-full rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>

          {/* Entries */}
          <div className="flex-1 overflow-y-auto">
            {worklistLoading && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                <p className="text-xs">Loading worklist…</p>
              </div>
            )}
            {!worklistLoading && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-slate-400">
                <ListFilter className="h-6 w-6" />
                <p className="text-xs">No studies match this view. Adjust filters or pick another worklist.</p>
              </div>
            )}
            {entries.map((e) => {
              const active = selected?.id === e.id;
              return (
                <button
                  key={e.id}
                  onClick={() => openStudy(e)}
                  onContextMenu={(ev) => onContextMenu(ev, buildContextMenu(e))}
                  title={e.studyInstanceUid ? `Open ${e.studyInstanceUid.slice(0,20)}… in OHIF` : `Open ${e.accessionNumber ?? e.id} — StudyInstanceUID will be resolved from Orthanc/PACS`}
                  className={cn(
                    "group relative w-full border-b border-slate-100 px-3 py-2.5 text-left transition-colors dark:border-slate-800/60",
                    active ? "bg-brand-soft/70 ring-1 ring-inset ring-brand/20" : "hover:bg-slate-50 dark:hover:bg-slate-900"
                  )}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("truncate text-[12px] font-semibold", active ? "text-brand-text" : "text-slate-800 dark:text-slate-100")}>
                          {e.patientLastName}, {e.patientFirstName ?? "—"}
                        </span>
                        {e.priority && e.priority.toLowerCase() !== "routine" && (
                          <span className={cn("shrink-0 rounded px-1 py-px text-[8px] font-bold uppercase tracking-wide", PRIORITY_STYLE[e.priority.toLowerCase()] ?? PRIORITY_STYLE.routine)}>
                            {e.priority}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500 dark:text-slate-400">
                        {e.procedure} · {e.modality}{e.bodyPart ? ` · ${e.bodyPart}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-slate-400">{entrySubtitle(e)}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn("rounded px-1 py-px text-[8px] font-medium capitalize", STAGE_STYLE[e.stage] ?? STAGE_STYLE.referral)}>{STAGE_LABEL[e.stage] ?? e.stage}</span>
                      {e.accessionNumber && <span className="font-mono text-[8px] text-slate-400">{e.accessionNumber}</span>}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-wide", active ? "bg-brand text-white" : "bg-slate-100 text-slate-600 group-hover:bg-brand group-hover:text-white dark:bg-slate-800 dark:text-slate-400")}>
                      <Eye className="h-3 w-3" /> OPEN STUDY
                    </span>
                    {e.studyInstanceUid ? (
                      <span className="max-w-[110px] truncate font-mono text-[8px] text-slate-400">{e.studyInstanceUid.slice(0, 20)}…</span>
                    ) : (
                      <span className="text-[8px] text-amber-600 dark:text-amber-400">Resolving UID…</span>
                    )}
                  </div>
                  {active && <ChevronRight className="absolute right-1 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-brand" />}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Context Menu */}
      {menu && (
        <ContextMenu items={menu.items} position={{ x: menu.x, y: menu.y }} onClose={close} />
      )}
    </div>
  );
}

function FilterRow({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2">
      <span className="flex w-20 shrink-0 items-center gap-1 text-[10px] font-medium text-slate-500 dark:text-slate-400">
        <Icon className="h-3 w-3" /> {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </label>
  );
}

function BookmarkList({ onClose }: { onClose: () => void }) {
  const { bookmarks, openStudy, entries } = useWorkstation();
  const resolved = useMemo(
    () =>
      bookmarks.map((b) => {
        const entry = entries.find((e) => e.id === b.studyId);
        return { ...b, entry };
      }),
    [bookmarks, entries]
  );
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200">
          <Star className="h-3.5 w-3.5 text-amber-400" /> Saved Studies
        </p>
        <button onClick={onClose} className="text-[10px] font-medium text-brand-text hover:underline">Back to worklist</button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {resolved.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-slate-400">No bookmarks yet. Use the bookmark button while reviewing a study.</p>
        )}
        {resolved.map((b) => (
          <button
            key={b.id}
            onClick={() => b.entry ? openStudy(b.entry) : undefined}
            className="mb-1.5 w-full rounded-lg border border-slate-200 p-2.5 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/50 dark:border-slate-800 dark:hover:border-amber-700 dark:hover:bg-amber-950/30"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">{b.label}</p>
              <Bookmark className="h-3 w-3 shrink-0 text-amber-400" />
            </div>
            {b.note && <p className="mt-0.5 truncate text-[10px] text-slate-500">{b.note}</p>}
            <p className="mt-1 text-[9px] text-slate-400">
              {b.entry ? `${b.entry.patientLastName}, ${b.entry.patientFirstName} · ${b.entry.modality}` : new Date(b.createdAt).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
