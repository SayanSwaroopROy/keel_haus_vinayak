"use client";

import { LayoutDashboardIcon, LogOutIcon, MenuIcon, PackageIcon, ScrollTextIcon, StoreIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { useQueryClient } from "@tanstack/react-query";
import { Trilabel } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ANY_MOCKED } from "@/lib/api/mode";
import { useSession } from "@/lib/auth/session";
import { NAV_LABELS } from "@/lib/i18n/labels";
import { NotificationBell } from "./notification-bell";

const NAV = [
  { href: "/", label: NAV_LABELS.dashboard, icon: LayoutDashboardIcon },
  { href: "/requisitions", label: NAV_LABELS.requisitions, icon: ScrollTextIcon },
  { href: "/inventory", label: NAV_LABELS.inventory, icon: PackageIcon },
  { href: "/vendors", label: NAV_LABELS.vendors, icon: StoreIcon },
] as const;

function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <span className="text-[1.35rem] font-medium tracking-[0.22em]">VINAYAK</span>
      <span className="mt-1 text-[0.62rem] tracking-[0.18em] text-binding-foreground/80">PROCUREMENT · HOD</span>
    </span>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-binding-foreground/90 transition-colors hover:bg-binding-deep/60 hover:text-binding-foreground focus-visible:outline-binding-foreground",
              active && "bg-binding-deep text-binding-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <Trilabel label={label} subClassName="text-binding-foreground/75" />
          </Link>
        );
      })}
    </nav>
  );
}

function UserBlock() {
  const router = useRouter();
  const client = useQueryClient();
  const { session, signOut } = useSession();
  return (
    <div className="flex items-center justify-between gap-2 border-t border-sidebar-border pt-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{session?.user.name}</p>
        <p className="text-xs text-binding-foreground/75">Contracts &amp; Planning HOD</p>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Sign out"
        className="text-binding-foreground hover:bg-binding-deep hover:text-binding-foreground"
        onClick={() => {
          signOut();
          client.clear();
          router.replace("/login");
        }}
      >
        <LogOutIcon />
      </Button>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col justify-between bg-binding p-4 text-binding-foreground lg:flex">
        <div className="flex flex-col gap-8">
          <Link href="/" className="px-3 pt-2 focus-visible:outline-binding-foreground">
            <Wordmark />
          </Link>
          <NavLinks />
        </div>
        <UserBlock />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 w-px bg-binding-foreground/20" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 bg-binding px-2 text-binding-foreground lg:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open menu"
                  className="size-11 text-binding-foreground hover:bg-binding-deep hover:text-binding-foreground"
                />
              }
            >
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 border-none bg-binding p-4 text-binding-foreground">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <SheetDescription className="sr-only">Go to a section of the HOD workspace</SheetDescription>
              <div className="flex h-full flex-col justify-between pt-10">
                <div className="flex flex-col gap-8">
                  <Wordmark className="px-3" />
                  <NavLinks onNavigate={() => setMenuOpen(false)} />
                </div>
                <UserBlock />
              </div>
            </SheetContent>
          </Sheet>
          <Link href="/" className="focus-visible:outline-binding-foreground">
            <Wordmark className="items-center" />
          </Link>
          <NotificationBell tone="binding" />
        </header>

        {ANY_MOCKED ? (
          <p role="note" className="border-b border-unsure/30 bg-unsure-soft px-4 py-1.5 text-xs text-unsure-foreground sm:px-8">
            Demo data: requisitions, stock, vendors and dashboard figures are simulated until the backend endpoints are live.
          </p>
        ) : null}

        <div className="flex flex-1 flex-col">{children}</div>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-rule px-4 pt-6 pb-5 sm:px-8 sm:pt-8">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-2xl font-medium text-balance">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        {actions}
        <span className="hidden lg:inline-flex">
          <NotificationBell tone="page" />
        </span>
      </div>
    </header>
  );
}
