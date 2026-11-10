import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { act, getJSON } from "@/lib/api";
import { startDemo } from "@/lib/demo";
import { toast } from "sonner";

/**
 * Tours span pages: the state lives in sessionStorage ({ kind, i }) and TourRunner (tour/runner.tsx) re-applies the
 * current step after every navigation. Each step names the page it belongs to and the element it points at;
 * a missing element shows the step centred instead of failing.
 */
export type TourKind = "judge" | "product";
export interface Ctx {
  demoPo: string | null;
  people: Record<string, string>;
  role: "owner" | "receiving" | "supplier" | null;
}
export interface Step {
  path: (c: Ctx) => string | null; // null: stay where you are
  el?: string;
  title: string;
  body: string | ((c: Ctx) => string);
  /** Runs when the person presses Next on this step (e.g. sign in as the next persona). */
  next?: (c: Ctx) => Promise<void>;
}

const KEY = "ss-tour";
export const SEEN = (role: string) => `ss-tour-seen-${role}`;

const signInAs = (first: string) => async (c: Ctx) => {
  if (c.people[first]) await act("/login", { person_id: c.people[first], next: "/home" });
};
const po = (c: Ctx) => (c.demoPo ? `/po/${c.demoPo}` : "/home");

export const JUDGE: Step[] = [
  { path: () => "/", el: "[data-tour=hero]", title: "Pay for what actually arrived", body: "StockSure is for a café and the wholesaler that supplies it. When a delivery turns up short, damaged or mis-billed, both sides agree what came off the truck, and PayPal charges exactly that. This tour takes about three minutes." },
  { path: () => "/", el: "[data-tour=trust]", title: "Who does what", body: "AI reads the paperwork and proposes counts. Code works out the money from the quote and the confirmed counts. PayPal holds, captures and releases. The model never sets a price, a quantity or a payee." },
  { path: () => "/login", el: "[data-tour=personas]", title: "Three people, two companies", body: "Jordan owns Laneway Café, Sam receives deliveries there, and Ana runs Harbour Wholesale. Press Next to sign in as Jordan.", next: signInAs("Jordan") },
  { path: () => "/home", el: "[data-tour=needs]", title: "What needs Jordan", body: "Only orders that are waiting on this person are shown here. Each card's tally strip shows packs ordered, and after counting, what was accepted, damaged or short." },
  { path: po, el: "[data-tour=next-step]", title: "One next step at a time", body: "The order page always leads with the single thing this person can do now. Accepting the quote places a PayPal hold for the quote total. That's an authorization, not a charge." },
  { path: po, el: "[data-tour=lines]", title: "The tally strip", body: "One mark per case. Ink is accepted, struck red is damaged, dashed is short or wrong. The receiver confirms these counts; the AI only proposes them." },
  { path: po, el: "[data-tour=money]", title: "Where the money is", body: "The spend limit is split into what's charged, what's still held, what PayPal is releasing (not spendable until confirmed) and what's left." },
  { path: po, el: "[data-tour=resolution]", title: "Agree once, pay exactly that", body: "Pay = quote price × accepted units, in whole cents. Shortfalls are credited or replaced within the limit. Both sides approve the same fingerprinted version. The invoice is compared, never paid from." },
  { path: po, el: "[data-tour=paypal-ops]", title: "Live PayPal sandbox", body: "Every PayPal call is listed with its PayPal id and request id. Retries reuse the request id, so nothing is charged twice. These ids can be checked in the sandbox." },
  { path: po, el: "[data-tour=docs]", title: "Paperwork can't move money", body: "The sample invoice hides a line telling an assistant to pay $500 elsewhere. It's removed before anything reads the document, and no PayPal call takes a payee." },
  { path: () => "/approvals", el: "[data-tour=approvals]", title: "Held for the owner", body: "A capture or refund above the owner's threshold, or one a scam rule flags, waits here with the reasons, what will move, and to whom. Large amounts need a passkey." },
  { path: () => "/demo", el: "[data-tour=live]", title: "What's live, what's simulated", body: "PayPal sandbox and the OpenAI reader are live. The demo controls reset the data and can inject a PayPal failure to show retries and read-back." },
  { path: () => "/demo", el: "[data-tour=script]", title: "Run the whole loop", body: "Follow these steps as Jordan, Ana and Sam to take an order from hold to capture to replacement. Every figure here comes from the live demo order. The Evidence page has the eval tables and the agent arena." },
];

const PRODUCT: Record<"owner" | "receiving" | "supplier", Step[]> = {
  owner: [
    { path: () => "/home", el: "[data-tour=needs]", title: "Your orders, sorted by what needs you", body: "Orders waiting on you come first. Everything else is below." },
    { path: () => "/home", el: "[data-tour=order-card]", title: "Read a delivery at a glance", body: "The tally strip shows packs ordered, then accepted, damaged or short once your team counts them." },
    { path: () => "/home", el: "[data-tour=nav-approvals]", title: "Approvals", body: "Payments held for you, with the reasons. Nothing above your threshold moves without you." },
    { path: () => "/home", el: "[data-tour=display]", title: "Display and help", body: "Bigger text, high contrast, an easier font, read-aloud and voice typing. Your choice stays on this device." },
    { path: () => "/home", el: "[data-tour=take-tour]", title: "Tour any time", body: "Take the tour again from here, or open the full judge walk-through." },
  ],
  receiving: [
    { path: () => "/home", el: "[data-tour=needs]", title: "Deliveries to count", body: "Anything on the truck for you shows here. Open it to count it in." },
    { path: () => "/home", el: "[data-tour=order-card]", title: "One mark per pack", body: "When you confirm counts, the tally strip fills in: accepted, damaged, short." },
    { path: () => "/home", el: "[data-tour=display]", title: "Display and help", body: "Bigger buttons and text for the back door, and voice typing." },
    { path: () => "/home", el: "[data-tour=take-tour]", title: "Tour any time", body: "You can come back to this tour whenever you like." },
  ],
  supplier: [
    { path: () => "/home", el: "[data-tour=needs]", title: "Orders waiting on you", body: "Quotes to confirm, orders to ship, counts to agree, fixes to approve." },
    { path: () => "/home", el: "[data-tour=order-card]", title: "What the café counted", body: "After the café counts a delivery, the tally strip shows what they accepted. You agree or dispute each line." },
    { path: () => "/home", el: "[data-tour=display]", title: "Display and help", body: "Text size, contrast and read-aloud." },
    { path: () => "/home", el: "[data-tour=take-tour]", title: "Tour any time", body: "The full judge walk-through starts here." },
  ],
};

interface State {
  kind: TourKind;
  i: number;
  ctx: Ctx;
}
export const readState = (): State | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const write = (s: State | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the tour still runs on this page */
  }
  dispatchEvent(new Event("ss-tour"));
};

export const stepsOf = (s: State) => (s.kind === "judge" ? JUDGE : PRODUCT[s.ctx.role ?? "owner"]);

export async function startTour(kind: TourKind) {
  const load = () =>
    Promise.all([
      getJSON<{ po: { id: string } | null }>("/api/ui/demo").catch(() => ({ po: null })),
      getJSON<{ people: { first: string; id: string }[]; needs_workspace?: boolean }>("/api/ui/people").catch(() => ({ people: [] as { first: string; id: string }[], needs_workspace: false })),
      getJSON<{ who: { role: "owner" | "receiving" | "supplier" } | null }>("/api/ui/session").catch(() => ({ who: null })),
    ]);
  let [demo, people, sess] = await load();
  // The tour signs in as each person, and people exist only inside a private demo: open one first (spec A1.2).
  if (people.needs_workspace) {
    const r = await startDemo();
    if (!r.ok) {
      toast.error(`Couldn't open a demo for the tour: ${r.message}`);
      return;
    }
    [demo, people, sess] = await load();
  }
  const ctx: Ctx = { demoPo: demo.po?.id ?? null, people: Object.fromEntries(people.people.map((p) => [p.first, p.id])), role: sess.who?.role ?? null };
  if (kind === "product" && !ctx.role) kind = "judge";
  write({ kind, i: 0, ctx });
}

let d: Driver | null = null;
/** One key listener for the whole app; it drives whichever step is showing. A generation number drops stale renders. */
let currentMove: ((delta: number) => void) | null = null;
let gen = 0;
let keysBound = false;
function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  addEventListener(
    "keydown",
    (e) => {
      if (!currentMove) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeTour(false);
      } else if (e.key === "ArrowRight") currentMove(1);
      else if (e.key === "ArrowLeft") currentMove(-1);
    },
    true,
  );
}
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.a11yMotion === "off";

export function closeTour(markSeen = false) {
  const s = readState();
  if (markSeen && s?.kind === "product" && s.ctx.role) {
    try {
      localStorage.setItem(SEEN(s.ctx.role), "1");
    } catch {
      /* ignore */
    }
  }
  if (s?.kind === "product" && s.ctx.role) {
    try {
      sessionStorage.setItem(`ss-tour-skip-${s.ctx.role}`, "1");
    } catch {
      /* ignore */
    }
  }
  write(null);
  hide();
}

export function hide() {
  currentMove = null;
  d?.destroy();
  d = null;
}

async function waitFor(sel: string | undefined, ms = 3500): Promise<Element | null> {
  if (!sel) return null;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const el = document.querySelector(sel);
    if (el && (el as HTMLElement).offsetParent !== null) return el;
    await new Promise((r) => setTimeout(r, 120));
  }
  return null;
}

/** Shows step s.i on the current page. The runner calls this after navigating to the step's page. */
export async function showStep(s: State, go: (path: string) => void) {
  const steps = stepsOf(s);
  const st = steps[s.i];
  if (!st) return closeTour(true);
  const my = ++gen;
  const el = await waitFor(st.el);
  if (my !== gen || readState()?.i !== s.i || readState()?.kind !== s.kind) return; // a newer render or step took over
  hide();
  const n = steps.length;
  let moved = false;
  const move = async (delta: number) => {
    if (moved || my !== gen || s.i + delta < 0) return;
    moved = true;
    currentMove = null;
    if (delta > 0 && st.next) await st.next(s.ctx).catch(() => {});
    const j = s.i + delta;
    if (j >= n) return closeTour(true);
    if (j < 0) return;
    const ns = { ...s, i: j };
    write(ns);
    const p = steps[j].path(s.ctx);
    if (p && p !== location.pathname) go(p);
  };
  d = driver({
    popoverClass: "ss-tour",
    animate: !reduced(),
    smoothScroll: !reduced(),
    overlayOpacity: 0.5,
    stagePadding: 6,
    stageRadius: 6,
    allowClose: true,
    allowKeyboardControl: false,
    onDestroyStarted: () => closeTour(false),
  });
  d.highlight({
    element: (el as Element) ?? undefined,
    popover: {
      title: st.title,
      description: typeof st.body === "function" ? st.body(s.ctx) : st.body,
      showButtons: ["next", "previous", "close"],
      disableButtons: s.i === 0 ? ["previous"] : [],
      nextBtnText: s.i === n - 1 ? "Finish" : st.next ? "Sign in and continue →" : "Next →",
      prevBtnText: "← Back",
      showProgress: true,
      progressText: `${s.i + 1} of ${n}`,
      onNextClick: () => void move(1),
      onPrevClick: () => void move(-1),
      onCloseClick: () => closeTour(false),
      onPopoverRender: (pop) => {
        if (s.kind === "product" && s.i === 0) {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = "Don't show again";
          b.addEventListener("click", () => closeTour(true));
          b.className = "ss-skip";
          pop.footer.insertBefore(b, pop.footerButtons);
        }
        pop.wrapper.setAttribute("role", "dialog");
        pop.wrapper.setAttribute("aria-label", `Tour step ${s.i + 1} of ${n}: ${st.title}`);
        setTimeout(() => pop.nextButton.focus(), 30);
      },
    },
  });
  bindKeys();
  currentMove = (delta) => void move(delta);
}
