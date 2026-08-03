"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpenText, Bot, ChartLine, Component, Newspaper, Palette, Shapes, TextCursorInput } from "lucide-react";

const items = [
  { href: "/", label: "Foundations", icon: Palette, exact: true },
  { href: "/components", label: "Components", icon: Component },
  { href: "/patterns", label: "Patterns", icon: Shapes },
  { href: "/forms", label: "Forms", icon: TextCursorInput },
  { href: "/stats", label: "Stats", icon: ChartLine },
  { href: "/chatbot", label: "Chatbot", icon: Bot, exact: true },
  { href: "/chatbot/content", label: "Content previews", icon: Newspaper },
];

const navItemClass = (active: boolean) =>
  `flex min-h-9 items-center justify-center gap-2.5 rounded-md px-0 text-[13px] transition-colors md:justify-start md:px-2.5 ${
    active
      ? "bg-sidebar-accent text-sidebar-accent-foreground"
      : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
  }`;

export function StyleguideNav() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-16 flex-col border-r border-sidebar-border bg-sidebar px-2 py-3.5 md:w-[248px] md:px-2.5">
      <div className="flex min-h-12 items-center justify-center gap-2.5 pb-4 pt-1.5 text-sidebar-foreground md:justify-start md:px-2">
        <span className="grid size-[34px] shrink-0 place-items-center rounded-lg bg-primary text-[11px] font-extrabold text-primary-foreground">VN</span>
        <span className="hidden min-w-0 md:grid">
          <strong className="truncate text-sm font-semibold">Vector Notion</strong>
          <small className="truncate text-[11px] text-muted-foreground">Design language</small>
        </span>
      </div>
      <nav className="grid gap-1">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
          return (
            <Link className={navItemClass(active)} href={item.href} key={item.href}>
              <item.icon size={17} /><span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden items-center gap-2 border-t border-sidebar-border px-2 pb-1 pt-3 text-[11px] text-muted-foreground md:flex">
        <BookOpenText size={14} />
        <span>The law: docs/design-language.md</span>
      </div>
    </aside>
  );
}
