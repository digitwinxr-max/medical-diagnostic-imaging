"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppShell } from "@/components/app-shell-context";
import {
  Activity,
  UserPlus,
  Calendar,
  GitBranch,
  Image,
  Wrench,
  Package,
  FileText,
  Settings,
  Bot,
  Receipt,
  Building2,
  BookOpen,
  ScanSearch,
  MonitorSmartphone,
  PanelLeftClose,
  PanelLeftOpen,
  LayoutDashboard,
  HeartPulse,
  ShieldCheck,
} from "lucide-react";

// accent: subtle semantic tint per section (active state only) —
// azure remains the default brand accent for every item.
const navigation: {
  name: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
  accent?: string;
}[] = [
  { name: "Command Centre", href: "/", icon: LayoutDashboard },
  { name: "Clinical", href: "/clinical", icon: HeartPulse },
  { name: "Workstation", href: "/workstation", icon: MonitorSmartphone, badge: "Primary" },
  { name: "Imaging", href: "/imaging", icon: Image },
  { name: "Reception", href: "/reception", icon: UserPlus },
  { name: "Scheduling", href: "/scheduling", icon: Calendar },
  { name: "Workflow", href: "/workflow", icon: GitBranch },
  { name: "AI Review", href: "/review", icon: ScanSearch, accent: "text-ai" },
  { name: "Reporting", href: "/reporting", icon: FileText },
  { name: "Knowledge", href: "/knowledge", icon: BookOpen },
  { name: "Equipment", href: "/equipment", icon: Wrench, accent: "text-operational" },
  { name: "Inventory", href: "/inventory", icon: Package },
  { name: "Finance", href: "/finance", icon: Receipt, accent: "text-premium" },
  { name: "System Health", href: "/system/health", icon: ShieldCheck },
  { name: "Administration", href: "/administration", icon: Building2 },
  { name: "AI Agents", href: "/agents", icon: Bot, accent: "text-ai" },
  { name: "Settings", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, toggleSidebar } = useAppShell();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r transition-[width] duration-200",
        "bg-[var(--color-gerald-navy)] border-[var(--color-gerald-navy-800)] text-slate-200",
        "dark:bg-[#0b1220] dark:border-[#1e3358]",
        sidebarCollapsed ? "w-16" : "w-64"
      )}
    >
      {/* Logo — premium navy header */}
      <div className={cn("flex h-16 items-center border-b border-white/10", sidebarCollapsed ? "justify-center px-2" : "gap-3 px-5")}>
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/gh-logo.png" alt="Gerald Holdings" className="h-9 w-9 object-contain" />
        </div>
        {!sidebarCollapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-[12px] font-bold leading-tight tracking-wide text-white">GERALD HOLDINGS</h1>
            <p className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/60">
              Diagnostic Imaging
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const active = isActive;
          return (
            <Link
              key={item.name}
              href={item.href}
              title={sidebarCollapsed ? item.name : undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg py-2.5 text-[13px] font-medium transition-colors duration-150",
                sidebarCollapsed ? "justify-center px-0" : "px-3",
                active
                  ? "bg-[var(--color-gerald-teal)] text-white shadow-sm"
                  : "text-white/70 hover:bg-white/10 hover:text-white"
              )}
            >
              <item.icon className={cn("h-[18px] w-5 flex-shrink-0", active ? "text-white" : "text-white/60")} />
              {!sidebarCollapsed && <span className="truncate">{item.name}</span>}
              {!sidebarCollapsed && "badge" in item && item.badge && (
                <span className="ml-auto shrink-0 rounded-full bg-white/20 px-1.5 py-0.5 text-[9px] font-semibold tracking-wide text-white">{item.badge}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 py-3">
        <div className={cn("flex items-center gap-3", sidebarCollapsed && "justify-center")}>
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white ring-1 ring-white/15">
            GH
          </div>
          {!sidebarCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-white">Gerald Holdings</p>
              <p className="truncate text-xs text-white/60">Administrator</p>
            </div>
          )}
          {!sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              title="Collapse sidebar (Ctrl+B)"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>
        {sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            className="mt-3 flex w-full items-center justify-center rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="Expand sidebar (Ctrl+B)"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
