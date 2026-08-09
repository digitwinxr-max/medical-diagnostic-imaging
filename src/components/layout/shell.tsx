"use client";

import React from "react";
import { Sidebar } from "./sidebar";
import { Header } from "./header";
import { useAppShell } from "@/components/app-shell-context";
import { cn } from "@/lib/utils";

interface ShellProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}

export function Shell({ title, description, children, actions }: ShellProps) {
  const { sidebarCollapsed } = useAppShell();

  return (
    <div className="min-h-screen bg-[var(--color-gerald-bg)] dark:bg-[var(--color-gerald-bg)]">
      <Sidebar />
      <div className={cn("transition-[margin] duration-200", sidebarCollapsed ? "ml-16" : "ml-64")}>
        <Header title={title} description={description} />
        <main className="p-6 lg:p-8">
          {actions && (
            <div className="mb-6 flex items-center justify-between">
              <div />
              <div className="flex items-center gap-3">{actions}</div>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}
