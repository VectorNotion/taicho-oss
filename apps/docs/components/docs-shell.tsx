"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpenText,
  ExternalLink,
  LifeBuoy,
  Menu,
  X,
} from "lucide-react";
import { TaichoMark } from "./taicho-mark";

export type DocumentationNavigation = Array<{
  title: string;
  items: Array<{ href: string; title: string }>;
}>;

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function Brand() {
  return (
    <Link className="flex shrink-0 items-center gap-2.5" href="/">
      <TaichoMark className="size-6 text-foreground" />
      <span className="font-heading text-lg font-bold tracking-tight">
        taicho<span className="text-primary">.ai</span>
      </span>
      <span aria-hidden="true" className="hidden h-5 w-px bg-border sm:block" />
      <span className="hidden text-sm font-medium text-muted-foreground sm:block">
        Docs
      </span>
    </Link>
  );
}

function DocsNavigation({
  className = "",
  navigation,
  onNavigate,
}: {
  className?: string;
  navigation: DocumentationNavigation;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Documentation navigation" className={className}>
      {navigation.map((section) => (
        <section className="mb-6" key={section.title}>
          <p className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.title}
          </p>
          <div className="grid gap-1">
            {section.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={classes(
                    "flex min-h-9 items-center rounded-md px-2.5 text-[13px] transition-colors",
                    active
                      ? "bg-sidebar-accent text-sidebar-accent-foreground"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  )}
                  href={item.href}
                  key={item.href}
                  onClick={onNavigate}
                >
                  {item.title}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </nav>
  );
}

function SiteHeader({
  navigation,
}: {
  navigation: DocumentationNavigation;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Brand />
        <nav
          aria-label="Taicho website navigation"
          className="ml-auto hidden items-center gap-1 lg:flex"
        >
          {[
            ["https://taicho.ai/features", "Features"],
            ["https://taicho.ai/pricing", "Pricing"],
            ["https://taicho.ai/posts", "Blog"],
          ].map(([href, label]) => (
            <a
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              href={href}
              key={href}
            >
              {label}
            </a>
          ))}
          <Link
            aria-current="page"
            className="rounded-md px-3 py-2 text-sm font-medium text-foreground"
            href="/"
          >
            Docs
          </Link>
        </nav>
        <div className="ml-auto hidden items-center gap-2 sm:flex lg:ml-4">
          <a
            className="inline-flex h-9 items-center rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-accent"
            href="https://taicho.ai/contact"
          >
            Take command.
          </a>
          <a
            className="inline-flex h-9 items-center gap-2 rounded-md bg-action px-4 text-sm font-bold text-action-foreground transition-colors hover:bg-action/90"
            href="https://cloud.taicho.ai"
          >
            Resume Command
            <ExternalLink className="size-4" />
          </a>
        </div>
        <button
          aria-expanded={open}
          aria-label={open ? "Close navigation" : "Open navigation"}
          className="ml-auto grid size-9 place-items-center rounded-md transition-colors hover:bg-accent sm:hidden"
          onClick={() => setOpen((value) => !value)}
          type="button"
        >
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      {open ? (
        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border bg-background px-4 py-5 sm:hidden">
          <DocsNavigation
            navigation={navigation}
            onNavigate={() => setOpen(false)}
          />
          <div className="grid grid-cols-2 gap-2 border-t border-border pt-4">
            <a
              className="inline-flex h-9 items-center justify-center rounded-md border text-sm font-medium"
              href="https://taicho.ai/contact"
            >
              Contact
            </a>
            <a
              className="inline-flex h-9 items-center justify-center rounded-md bg-action text-sm font-bold text-action-foreground"
              href="https://cloud.taicho.ai"
            >
              Open Taicho
            </a>
          </div>
        </div>
      ) : null}
    </header>
  );
}

function DocsFooter() {
  return (
    <footer className="mt-16 border-t border-border py-8">
      <div className="flex flex-col gap-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <TaichoMark className="size-5 text-foreground" />
          <span>
            Taicho is operated by{" "}
            <span className="text-foreground">Vector Notion Digital</span>.
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <a href="mailto:support@taicho.ai">Support</a>
          <a href="https://taicho.ai/privacy">Privacy</a>
          <a href="https://taicho.ai/terms">Terms</a>
        </div>
      </div>
    </footer>
  );
}

export function DocsShell({
  children,
  navigation,
}: Readonly<{
  children: React.ReactNode;
  navigation: DocumentationNavigation;
}>) {
  return (
    <div className="relative min-h-screen overflow-x-hidden">
      <div
        aria-hidden="true"
        className="docs-backdrop pointer-events-none fixed inset-0 -z-10"
      />
      <SiteHeader navigation={navigation} />
      <div className="mx-auto w-full max-w-7xl">
        <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[248px_minmax(0,1fr)]">
          <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar/60 px-2.5 py-8 backdrop-blur-sm lg:flex">
            <div className="mb-5 flex items-center gap-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <BookOpenText className="size-4" />
              Documentation
            </div>
            <DocsNavigation
              className="grid gap-1"
              navigation={navigation}
            />
            <a
              className="mt-auto flex items-center gap-2 border-t border-sidebar-border px-2.5 pt-4 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              href="mailto:support@taicho.ai"
            >
              <LifeBuoy className="size-3.5" />
              Get help from Taicho
            </a>
          </aside>
          <main className="min-w-0 px-4 py-10 sm:px-8 sm:py-14 lg:px-12 lg:py-16">
            <div className="mx-auto w-full max-w-5xl">
              {children}
              <DocsFooter />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
