import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";

/**
 * Spec A3.3: a tour starts only from a button, covers the page it was started on, ends on any route change
 * (TourRunner in tour/runner.tsx) and never navigates or signs anyone in. The judge walk-through is the /judge page,
 * where each step is a link the visitor follows themselves.
 */
export interface Step {
  el: string;
  title: string;
  body: string;
}

/** Every step that can appear; a tour shows the ones whose element is on the current page, in this order. */
export const STEPS: Step[] = [
  { el: "[data-tour=needs]", title: "What needs you", body: "Orders waiting on you come first. Everything else is below." },
  { el: "[data-tour=order-card]", title: "Read a delivery at a glance", body: "The tally strip shows packs ordered, then accepted, damaged or short once the delivery is counted." },
  { el: "[data-tour=next-step]", title: "One next step at a time", body: "The order page leads with the single thing you can do now." },
  { el: "[data-tour=lines]", title: "The tally strip", body: "One mark per case. Ink is accepted, struck red is damaged, dashed is short or wrong. The receiver confirms these counts; the AI only proposes them." },
  { el: "[data-tour=money]", title: "Where the money is", body: "The spend limit split into charged, still held, being released (not spendable until PayPal confirms) and left." },
  { el: "[data-tour=resolution]", title: "Agree once, pay exactly that", body: "Pay = quote price × accepted units, in whole cents. Both sides approve the same fingerprinted version." },
  { el: "[data-tour=paypal-ops]", title: "Live PayPal sandbox", body: "Every PayPal call with its PayPal id and request id. Retries reuse the request id, so nothing is charged twice." },
  { el: "[data-tour=approvals]", title: "Held for the owner", body: "Captures or refunds above your threshold, or flagged by the scam check, wait here with the reasons." },
  { el: "[data-tour=nav-approvals]", title: "Approvals", body: "Payments held for you. Nothing above your threshold moves without you." },
  { el: "[data-tour=nav-ask]", title: "Ask", body: "Ask about your orders and PayPal records. Every tool call shows as it runs; no tool can move money." },
  { el: "[data-tour=display]", title: "Display and help", body: "Bigger text, high contrast, an easier font, read-aloud and voice typing. Your choice stays on this device." },
];

interface State {
  i: number;
  path: string;
  steps: Step[];
}
let state: State | null = null;
let d: Driver | null = null;
let move: ((delta: number) => void) | null = null;
let keysBound = false;
function bindKeys() {
  if (keysBound) return;
  keysBound = true;
  addEventListener(
    "keydown",
    (e) => {
      if (!state || !move) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeTour();
      } else if (e.key === "ArrowRight") move(1);
      else if (e.key === "ArrowLeft") move(-1);
    },
    true,
  );
}

const visible = (sel: string) => {
  const el = document.querySelector(sel) as HTMLElement | null;
  return el && el.offsetParent !== null ? el : null;
};
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.a11yMotion === "off";

/** Started by a button press only. */
export function startTour() {
  const steps = STEPS.filter((s) => visible(s.el));
  if (!steps.length) return;
  state = { i: 0, path: location.pathname, steps };
  show();
}

export const tourPath = () => state?.path ?? null;

export function closeTour() {
  state = null;
  move = null;
  d?.destroy();
  d = null;
}

function show() {
  if (!state) return;
  const s = state;
  const st = s.steps[s.i];
  const n = s.steps.length;
  d?.destroy();
  const step = (delta: number) => {
    if (!state) return;
    const j = state.i + delta;
    if (j >= n) return closeTour();
    if (j < 0) return;
    state = { ...state, i: j };
    show();
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
    onDestroyStarted: () => closeTour(),
  });
  d.highlight({
    element: visible(st.el) ?? undefined,
    popover: {
      title: st.title,
      description: st.body,
      showButtons: ["next", "previous", "close"],
      disableButtons: s.i === 0 ? ["previous"] : [],
      nextBtnText: s.i === n - 1 ? "Finish" : "Next →",
      prevBtnText: "← Back",
      showProgress: true,
      progressText: `${s.i + 1} of ${n}`,
      onNextClick: () => step(1),
      onPrevClick: () => step(-1),
      onCloseClick: () => closeTour(),
      onPopoverRender: (pop) => {
        pop.wrapper.setAttribute("role", "dialog");
        pop.wrapper.setAttribute("aria-label", `Tour step ${s.i + 1} of ${n}: ${st.title}`);
        setTimeout(() => pop.nextButton.focus(), 30);
      },
    },
  });
  move = step;
  bindKeys();
}
