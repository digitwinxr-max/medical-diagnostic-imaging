"use client";

import React, { useEffect, useState } from "react";
import { LogOut, KeyRound, Command, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { NotificationCentre } from "@/components/notification-centre";
import { useAppShell } from "@/components/app-shell-context";

interface MeState {
  authenticated: boolean;
  keycloakEnabled: boolean;
  user?: { name: string; roles: string[]; iss: string };
}

export function Header({ title, description }: { title: string; description?: string }) {
  const [me, setMe] = useState<MeState | null>(null);
  const { theme, toggleTheme, setPaletteOpen } = useAppShell();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMe(d))
      .catch(() => setMe(null));
  }, []);

  const initials = me?.user?.name
    ? me.user.name
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase()
    : null;

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-gerald-border)] bg-white/90 px-6 lg:px-8 backdrop-blur-md dark:border-[var(--color-gerald-border)] dark:bg-[var(--color-gerald-surface)]/90">
      <div className="min-w-0">
        <h1 className="truncate text-[17px] font-semibold tracking-tight text-[var(--color-gerald-text)] dark:text-[var(--color-gerald-text)]">{title}</h1>
        {description && <p className="truncate text-sm text-[var(--color-gerald-muted)]">{description}</p>}
      </div>
      <div className="flex items-center gap-3">
        {/* Command palette trigger */}
        <button
          onClick={() => setPaletteOpen(true)}
          className="hidden items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600 md:flex dark:border-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-300"
        >
          <Command className="h-3.5 w-3.5" />
          <span>Search or run…</span>
          <kbd className="rounded border border-slate-200 px-1 text-[10px] font-medium dark:border-slate-700">⌘K</kbd>
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        <NotificationCentre />

        {me?.authenticated && me.user ? (
          <div className="flex items-center gap-3 border-l border-slate-200 pl-4 dark:border-slate-800">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-hover text-xs font-semibold text-white">
              {initials}
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-medium leading-tight text-slate-900 dark:text-slate-100">{me.user.name}</p>
              <div className="flex items-center gap-1">
                {me.user.roles.slice(0, 2).map((r) => (
                  <Badge key={r} variant="outline" className="text-[10px] leading-none">
                    {r}
                  </Badge>
                ))}
              </div>
            </div>
            <a href="/api/auth/logout" title="Sign out">
              <Button variant="ghost" size="icon">
                <LogOut className="h-4 w-4 text-slate-400" />
              </Button>
            </a>
          </div>
        ) : (
          <a href="/login" className="flex items-center gap-1 text-sm font-medium text-brand-text hover:text-brand-active">
            <KeyRound className="h-4 w-4" />
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}
