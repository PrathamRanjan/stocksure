import type { ReactNode } from "react";
import { Link } from "react-router";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Logo, useOnline } from "@/components/brand";
import { DemoRibbon, DisplayButton, ThemeButton } from "@/components/shell";
import { WifiOff } from "lucide-react";

/** Frame for pages anyone can open: landing, sign-in, demo controls, judge mode. */
export function PublicShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session } = useSession();
  const who = session?.who;
  const online = useOnline();
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only z-50 rounded-md bg-foreground px-3 py-2 text-background focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <DemoRibbon />
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="text-xl" aria-label="StockSure home">
            <Logo />
          </Link>
          <nav aria-label="Site" className="ml-6 hidden items-center gap-5 text-[0.95rem] font-semibold md:flex">
            <a href="/#how" className="hover:underline">How it works</a>
            <a href="/#pricing" className="hover:underline">Pricing</a>
            <Link to="/demo" className="hover:underline">Demo</Link>
            <a href="/evidence" className="hover:underline">Evidence</a>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <DisplayButton />
            <ThemeButton />
            {who ? (
              <Button asChild size="sm">
                <Link to="/home">Open orders</Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <Link to="/login">Sign in</Link>
              </Button>
            )}
          </div>
        </div>
        {!online && (
          <p role="status" className="flex items-center gap-2 border-t border-held/40 bg-held-soft px-4 py-1.5 text-sm text-held">
            <WifiOff className="size-4" aria-hidden="true" /> Offline. Reconnect to sign in or change anything.
          </p>
        )}
      </header>
      <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12 ${wide ? "max-w-6xl" : "max-w-3xl"}`}>
        {children}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <Logo compact />
          <span>Built for the PayPal hackathon. Sandbox only: no real money moves.</span>
          <span className="ml-auto flex gap-4">
            <a href="/evidence" className="hover:text-foreground">Evidence</a>
            <Link to="/demo" className="hover:text-foreground">Demo controls</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
