import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import {
  BadgeCheck, BookOpenCheck, Boxes, CalendarClock, ChartNoAxesColumn, ClipboardList, Contrast, FileWarning, Gauge, Handshake, LogOut, Menu, MessageSquare, Moon,
  PackageCheck, Search, ShieldCheck, Sun, Table2, Truck, UserRound, UsersRound, WifiOff, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { act } from "@/lib/api";
import { useSession, type Who } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Logo, useOnline } from "@/components/brand";
import { startTour } from "@/tour/tours";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  server?: boolean;
  badge?: number;
  tour?: string;
}

/** What each person can open. Server pages (server: true) are full page loads in the same identity. */
export function navFor(who: Who | null, counts: { needs: number; approvals: number }): { main: NavItem[]; tools: NavItem[] } {
  if (!who) return { main: [], tools: [] };
  if (who.side === "supplier")
    return {
      main: [
        { to: "/home", label: "Orders", icon: ClipboardList, badge: counts.needs, tour: "nav-orders" },
        { to: "/catalog", label: "Catalog", icon: Boxes },
        { to: "/performance", label: "Performance", icon: ChartNoAxesColumn },
        { to: "/deliveries", label: "Deliveries", icon: CalendarClock, server: true },
      ],
      tools: [
        { to: "/disputes", label: "PayPal disputes", icon: FileWarning, server: true },
        { to: "/negotiations", label: "Negotiations", icon: Handshake, server: true },
        { to: "/ledger", label: "Ledger", icon: Table2, server: true },
        { to: "/channels", label: "Phone alerts", icon: MessageSquare, server: true },
        { to: "/evidence", label: "Evidence", icon: BookOpenCheck, server: true },
      ],
    };
  if (who.role === "receiving")
    return {
      main: [
        { to: "/home", label: "Deliveries", icon: ClipboardList, badge: counts.needs, tour: "nav-orders" },
        { to: "/dock", label: "Dock (camera)", icon: Truck, server: true },
        { to: "/stock", label: "Stock", icon: PackageCheck },
        { to: "/catalog", label: "Catalog", icon: Boxes },
      ],
      tools: [
        { to: "/channels", label: "Phone alerts", icon: MessageSquare, server: true },
        { to: "/evidence", label: "Evidence", icon: BookOpenCheck, server: true },
      ],
    };
  return {
    main: [
      { to: "/home", label: "Orders", icon: ClipboardList, badge: counts.needs, tour: "nav-orders" },
      { to: "/approvals", label: "Approvals", icon: BadgeCheck, badge: counts.approvals, tour: "nav-approvals" },
      { to: "/stock", label: "Stock", icon: PackageCheck },
      { to: "/performance", label: "Record", icon: ChartNoAxesColumn },
    ],
    tools: [
      { to: "/guard", label: "Spending rules", icon: Gauge, server: true },
      { to: "/safety", label: "Scam check", icon: ShieldCheck, server: true },
      { to: "/catalog", label: "Catalog", icon: Boxes },
      { to: "/ledger", label: "Ledger", icon: Table2, server: true },
      { to: "/deliveries", label: "Deliveries board", icon: CalendarClock, server: true },
      { to: "/disputes", label: "PayPal disputes", icon: FileWarning, server: true },
      { to: "/negotiations", label: "Agent negotiations", icon: Handshake, server: true },
      { to: "/channels", label: "Phone alerts", icon: MessageSquare, server: true },
      { to: "/evidence", label: "Evidence", icon: BookOpenCheck, server: true },
    ],
  };
}

function NavEntry({ n, onClick, compact = false }: { n: NavItem; onClick?: () => void; compact?: boolean }) {
  const cls = (active: boolean) =>
    cn(
      "group flex min-h-11 items-center gap-3 rounded-md px-3 text-[0.95rem] font-semibold transition-colors sm:min-h-10",
      active ? "bg-foreground text-background" : "text-foreground/85 hover:bg-accent hover:text-foreground",
      compact && "flex-col justify-center gap-0.5 px-1 text-[0.7rem] font-semibold",
    );
  const inner = (
    <>
      <n.icon className={cn("size-[18px] shrink-0", compact && "size-5")} aria-hidden="true" />
      <span className={cn(!compact && "flex-1")}>{n.label}</span>
      {!!n.badge && !compact && <span className="num rounded-sm bg-held px-1.5 text-xs font-bold text-card dark:text-background">{n.badge}</span>}
      {!!n.badge && compact && <span className="sr-only">({n.badge} waiting)</span>}
    </>
  );
  if (n.server)
    return (
      <a href={n.to} className={cls(false)} onClick={onClick} data-tour={n.tour}>
        {inner}
      </a>
    );
  return (
    <NavLink to={n.to} end={n.to === "/home"} className={({ isActive }) => cls(isActive)} onClick={onClick} data-tour={n.tour}>
      {inner}
    </NavLink>
  );
}

export function DemoRibbon() {
  const { session } = useSession();
  // Render the frame before the session arrives so the page doesn't jump when it does.
  if (session && !session.demo) return null;
  const bit = (on: boolean, l: string) => (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block size-1.5 rounded-full", on ? "bg-paid" : "bg-muted-foreground")} aria-hidden="true" />
      {l} {on ? "live" : "simulated"}
    </span>
  );
  return (
    <div className="border-b border-dashed border-input bg-paper-2 text-[0.8125rem]" role="region" aria-label="Demo status" data-tour="ribbon">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1.5">
        <span className="font-heading font-extrabold uppercase tracking-wider" style={{ fontVariationSettings: '"wdth" 125' }}>Hackathon demo</span>
        <span className="hidden flex-wrap gap-x-3 text-muted-foreground sm:flex">
          {session && (
            <>
              {bit(session.paypal_ready, `PayPal ${session.paypal_env}`)}
              {bit(!/parser/.test(session.reader), "AI reader")}
              {bit(session.channels.telegram, "Telegram")}
            </>
          )}
        </span>
        <span className="text-muted-foreground sm:hidden">Sandbox · no real money</span>
        <span className="ml-auto flex items-center gap-3">
          <button type="button" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 sm:min-h-8" onClick={() => startTour("judge")} data-tour="take-tour">
            Take the tour
          </button>
          <Link to="/demo" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2 sm:min-h-8">
            Reset & setup
          </Link>
        </span>
      </div>
    </div>
  );
}

export function ThemeButton() {
  const { resolved, set } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={() => set(resolved === "dark" ? "light" : "dark")} aria-label={resolved === "dark" ? "Use light theme" : "Use dark theme"}>
      {resolved === "dark" ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

export function DisplayButton({ className }: { className?: string }) {
  return (
    <Button variant="ghost" size="sm" className={cn("min-h-11 min-w-11", className)} data-a11y-open aria-haspopup="dialog" data-tour="display">
      <Contrast aria-hidden="true" /> <span className="hidden sm:inline">Display</span>
      <span className="sr-only sm:hidden">Display and help</span>
    </Button>
  );
}

function UserMenu({ who }: { who: Who }) {
  const nav = useNavigate();
  const { refresh } = useSession();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 justify-start" aria-label={`Signed in as ${who.name}. Account menu`}>
          <UserRound aria-hidden="true" />
          <span className="truncate">{who.first}</span>
          <span className="hidden truncate text-muted-foreground lg:inline">· {who.org}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <p className="font-semibold">{who.name}</p>
          <p className="font-normal text-muted-foreground">{who.org} · {who.side === "supplier" ? "supplier" : who.owner ? "owner" : "receiving"}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => nav("/login")}>
          <UsersRound aria-hidden="true" /> Switch person
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await act("/logout");
            refresh();
            nav("/");
          }}
        >
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Palette({ open, setOpen, items }: { open: boolean; setOpen: (b: boolean) => void; items: NavItem[] }) {
  const nav = useNavigate();
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to" description="Jump to a page">
      <CommandInput placeholder="Go to… (orders, approvals, stock, ledger)" />
      <CommandList>
        <CommandEmpty>No page matches.</CommandEmpty>
        <CommandGroup heading="Pages">
          {items.map((n) => (
            <CommandItem
              key={n.to}
              value={n.label}
              onSelect={() => {
                setOpen(false);
                if (n.server) location.href = n.to;
                else nav(n.to);
              }}
            >
              <n.icon aria-hidden="true" /> {n.label}
            </CommandItem>
          ))}
          <CommandItem value="Take the guided tour" onSelect={() => { setOpen(false); startTour("judge"); }}>
            <BookOpenCheck aria-hidden="true" /> Take the guided tour
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

/** Signed-in frame: sidebar (desktop), top bar and bottom bar plus a sheet (phones). */
export function AppShell({ children }: { children: ReactNode }) {
  const { session } = useSession();
  const who = session?.who ?? null;
  const { main, tools } = navFor(who, session?.counts ?? { needs: 0, approvals: 0 });
  const [sheet, setSheet] = useState(false);
  const [pal, setPal] = useState(false);
  const online = useOnline();
  const loc = useLocation();
  useEffect(() => setSheet(false), [loc.pathname]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPal((o) => !o);
      }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, []);
  const mobileMain = main.slice(0, 4);

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <DemoRibbon />
      <div className="mx-auto flex max-w-7xl">
        <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 border-r border-border px-3 py-5 lg:flex" aria-label="Main">
          <Link to={who ? "/home" : "/"} className="mb-5 px-2 text-xl">
            <Logo />
          </Link>
          <nav aria-label="Main" className="flex flex-col gap-0.5">
            {main.map((n) => <NavEntry key={n.to} n={n} />)}
          </nav>
          {tools.length > 0 && (
            <>
              <p className="mb-1 mt-6 px-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Controls and records</p>
              <nav aria-label="Controls and records" className="flex flex-col gap-0.5">
                {tools.map((n) => <NavEntry key={n.to} n={n} />)}
              </nav>
            </>
          )}
          <div className="mt-auto px-2 pt-4 text-xs text-muted-foreground">
            <button type="button" onClick={() => setPal(true)} className="inline-flex min-h-8 items-center gap-1.5 hover:text-foreground">
              <Search className="size-3.5" aria-hidden="true" /> Go to… <kbd className="rounded border border-input px-1 font-sans">⌘K</kbd>
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
            <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
              <Link to={who ? "/home" : "/"} className="lg:hidden" aria-label="StockSure home">
                <Logo className="text-lg" />
              </Link>
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => startTour("product")} data-tour="tour-btn">
                  <BookOpenCheck aria-hidden="true" /> Take the tour
                </Button>
                <DisplayButton />
                <ThemeButton />
                {who && <UserMenu who={who} />}
                {!who && (
                  <Button asChild size="sm">
                    <Link to="/login">Sign in</Link>
                  </Button>
                )}
              </div>
            </div>
            {!online && (
              <p role="status" className="flex items-center gap-2 border-t border-held/40 bg-held-soft px-4 py-1.5 text-sm text-held">
                <WifiOff className="size-4" aria-hidden="true" /> Offline. You can read this page; actions wait until you reconnect.
              </p>
            )}
          </header>
          <main id="main" tabIndex={-1} className="px-4 pb-28 pt-5 outline-none sm:px-6 sm:pt-7 lg:pb-12">
            {children}
          </main>
        </div>
      </div>

      {who && (
        <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          <div className="grid grid-cols-5 gap-1 px-2 py-1.5">
            {mobileMain.map((n) => <NavEntry key={n.to} n={n} compact />)}
            <button type="button" onClick={() => setSheet(true)} className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[0.7rem] font-semibold hover:bg-accent" aria-haspopup="dialog">
              <Menu className="size-5" aria-hidden="true" /> More
            </button>
          </div>
        </nav>
      )}
      <Sheet open={sheet} onOpenChange={setSheet}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="font-heading text-xl">More</SheetTitle>
            <SheetDescription>Controls, records and help.</SheetDescription>
          </SheetHeader>
          <nav aria-label="More" className="flex flex-col gap-0.5 px-4 pb-6">
            {[...main.slice(4), ...tools].map((n) => <NavEntry key={n.to} n={n} onClick={() => setSheet(false)} />)}
            <button type="button" className="flex min-h-11 items-center gap-3 rounded-md px-3 font-semibold hover:bg-accent" onClick={() => { setSheet(false); startTour("product"); }}>
              <BookOpenCheck className="size-[18px]" aria-hidden="true" /> Take the tour
            </button>
          </nav>
        </SheetContent>
      </Sheet>
      <Palette open={pal} setOpen={setPal} items={[...main, ...tools]} />
    </div>
  );
}
