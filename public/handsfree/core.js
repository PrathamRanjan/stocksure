// Look and Say, the pure part: gaze and head features, calibration fit, snapping, the command parser and the
// rule that decides which actions need a confirm card. No DOM and no camera here, so the same code runs in the
// browser and in the unit tests (test/handsfree.test.ts).
//
// Credits. The approach follows three projects, none of whose code is copied:
// - Peek (deixis): a highlight that snaps to controls by weighted, fading votes; a jump clears old votes; each
//   confirmed click corrects drift. Peek has no licence file, so this is a rewrite from its description.
// - OpenGaze (Calhacks-13): blink freeze, hand-back on real mouse movement, emergency stop, and logging why the
//   pointer did not move. No licence file either; rewritten from the description.
// - movo (Apache-2.0): head pointing from the nose against the eye-corner line, and eye openness for winks.

/** Landmark indices in MediaPipe's 478-point face mesh. */
export const LM = { leftOuter: 33, leftInner: 133, rightOuter: 263, rightInner: 362, nose: 1, irisA: 468, irisB: 473, top: 10, chin: 152 };

/**
 * Features from one frame of face landmarks (normalised 0..1, `aspect` = video width / height):
 * head yaw and pitch (movo's proxy), iris offset in each eye's own frame (averaged), face centre and size.
 */
export function features(lm, aspect = 4 / 3) {
  const p = (i) => (lm[i] ? { x: lm[i].x * aspect, y: lm[i].y } : null);
  const L = p(LM.leftOuter), Li = p(LM.leftInner), R = p(LM.rightOuter), Ri = p(LM.rightInner), N = p(LM.nose);
  if (!L || !R || !N || !Li || !Ri) return null;
  const iod = Math.hypot(R.x - L.x, R.y - L.y);
  if (iod < 1e-4) return null;
  const ux = (R.x - L.x) / iod, uy = (R.y - L.y) / iod;
  const mx = (L.x + R.x) / 2, my = (L.y + R.y) / 2;
  const dx = N.x - mx, dy = N.y - my;
  const yaw = (dx * ux + dy * uy) / iod;
  const pitch = (dy * ux - dx * uy) / iod;
  // Iris position inside each eye, along and across the eye's own corner line, in eye widths.
  const eye = (a, b, iris) => {
    const I = p(iris);
    if (!I) return null;
    const w = Math.hypot(b.x - a.x, b.y - a.y) || 1e-4;
    const ex = (b.x - a.x) / w, ey = (b.y - a.y) / w;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const ix = I.x - cx, iy = I.y - cy;
    return { u: (ix * ex + iy * ey) / w, v: (iy * ex - ix * ey) / w };
  };
  const e1 = eye(L, Li, LM.irisA), e2 = eye(Ri, R, LM.irisB);
  const gx = e1 && e2 ? (e1.u + e2.u) / 2 : 0;
  const gy = e1 && e2 ? (e1.v + e2.v) / 2 : 0;
  return { yaw, pitch, gx, gy, cx: mx / aspect, cy: my, size: iod, iris: !!(e1 && e2) };
}

/** Blink and wink from MediaPipe blendshape scores (0 open … 1 shut). */
export function eyes(blend) {
  const get = (name) => Number(blend?.find?.((b) => b.categoryName === name)?.score ?? 0);
  const l = get("eyeBlinkLeft"), r = get("eyeBlinkRight");
  return { left: l, right: r, blink: l > 0.45 && r > 0.45 };
}

/** One Euro filter (Casiez et al. 2012): smooth when still, quick when moving. */
export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: null });
  }
  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(value, tMs) {
    if (this.x === null) {
      this.x = value;
      this.t = tMs;
      return value;
    }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000);
    this.t = tMs;
    const ad = OneEuro.alpha(this.dCutoff, dt);
    this.dx = ad * ((value - this.x) / dt) + (1 - ad) * this.dx;
    const a = OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
  reset() {
    this.x = null;
  }
}

// ---- Calibration: ridge regression from features to screen, settings chosen by leave-one-dot-out ----

const basis = (f, mode, degree) => {
  const a = mode === "head" ? [f.yaw, f.pitch] : [f.gx, f.gy, f.yaw, f.pitch];
  const out = [1, ...a];
  if (degree === 2) for (let i = 0; i < a.length; i++) for (let j = i; j < a.length; j++) out.push(a[i] * a[j]);
  return out;
};

function solve(A, b) {
  // Gaussian elimination with partial pivoting; A is n×n.
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      for (let k2 = c; k2 <= n; k2++) M[r][k2] -= k * M[c][k2];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

function ridge(X, y, lambda) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let s = 0; s < X.length; s++) {
    for (let i = 0; i < n; i++) {
      b[i] += X[s][i] * y[s];
      for (let j = 0; j < n; j++) A[i][j] += X[s][i] * X[s][j];
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += lambda; // the intercept is not shrunk
  return solve(A, b);
}

/** Feature scaling so one lambda grid fits both head and gaze features. */
function scaler(samples, mode) {
  const keys = mode === "head" ? ["yaw", "pitch"] : ["gx", "gy", "yaw", "pitch"];
  const s = {};
  for (const k of keys) {
    const v = samples.map((x) => x.f[k]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
    s[k] = { m, sd };
  }
  return (f) => {
    const o = { ...f };
    for (const k of keys) o[k] = (f[k] - s[k].m) / s[k].sd;
    return o;
  };
}

function fitWith(samples, mode, degree, lambda) {
  const norm = scaler(samples, mode);
  const X = samples.map((s) => basis(norm(s.f), mode, degree));
  const wx = ridge(X, samples.map((s) => s.x), lambda);
  const wy = ridge(X, samples.map((s) => s.y), lambda);
  return { mode, degree, lambda, predict: (f) => { const b = basis(norm(f), mode, degree); return { x: b.reduce((a, v, i) => a + v * wx[i], 0), y: b.reduce((a, v, i) => a + v * wy[i], 0) }; } };
}

const median = (v) => {
  if (!v.length) return NaN;
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Fits a model for `mode` ("gaze" or "head") from calibration samples {dot, x, y, f}. The degree and ridge
 * strength are chosen by leave-one-dot-out cross-validation (median error in pixels). Returns the model and
 * the cross-validated error.
 */
export function fit(samples, mode) {
  const dots = [...new Set(samples.map((s) => s.dot))];
  let best = null;
  for (const degree of mode === "head" ? [1, 2] : [1, 2]) {
    for (const lambda of [0.01, 0.1, 1, 10]) {
      const errs = [];
      for (const d of dots) {
        const train = samples.filter((s) => s.dot !== d);
        const test = samples.filter((s) => s.dot === d);
        if (train.length < 6 || !test.length) continue;
        const m = fitWith(train, mode, degree, lambda);
        // Per held-out dot, the error of the median prediction (what the filtered pointer would show).
        const px = median(test.map((s) => m.predict(s.f).x));
        const py = median(test.map((s) => m.predict(s.f).y));
        errs.push(Math.hypot(px - test[0].x, py - test[0].y));
      }
      const cv = median(errs);
      if (Number.isFinite(cv) && (!best || cv < best.cv)) best = { degree, lambda, cv };
    }
  }
  if (!best) return null;
  const model = fitWith(samples, mode, best.degree, best.lambda);
  return { ...model, cv_px: Math.round(best.cv) };
}

/** Accuracy on check dots the model never saw: median distance in pixels between the dot and the prediction. */
export function accuracy(model, checks) {
  const byDot = new Map();
  for (const c of checks) (byDot.get(c.dot) ?? byDot.set(c.dot, []).get(c.dot)).push(c);
  const errs = [...byDot.values()].map((g) => {
    const px = median(g.map((s) => model.predict(s.f).x));
    const py = median(g.map((s) => model.predict(s.f).y));
    return Math.hypot(px - g[0].x, py - g[0].y);
  });
  return Math.round(median(errs));
}

/** Points for the 9-dot calibration, the 4 check dots and the 3-dot top-up, as fractions of the viewport. */
export const DOTS = {
  calibrate: [[0.1, 0.1], [0.5, 0.1], [0.9, 0.1], [0.1, 0.5], [0.5, 0.5], [0.9, 0.5], [0.1, 0.9], [0.5, 0.9], [0.9, 0.9]],
  check: [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]],
  topup: [[0.5, 0.5], [0.15, 0.15], [0.85, 0.85]],
};

/** Head mode becomes the default when gaze is too rough to pick a 44 px button even with snapping. */
export const GAZE_OK_PX = 110;
export const chooseMode = (gazePx, headPx) => (Number.isFinite(gazePx) && gazePx <= GAZE_OK_PX && !(headPx < gazePx * 0.7) ? "gaze" : "head");

/** Has the head moved since calibration (closer, further, or sideways)? */
export function headShifted(base, f) {
  if (!base || !f) return false;
  return Math.abs(f.size / base.size - 1) > 0.18 || Math.hypot(f.cx - base.cx, f.cy - base.cy) > 0.09;
}

// ---- Snapping: votes for nearby targets, fading, with hysteresis and a jump reset ----

export const distToRect = (p, r) => {
  const dx = Math.max(r.left - p.x, 0, p.x - r.right);
  const dy = Math.max(r.top - p.y, 0, p.y - r.bottom);
  return Math.hypot(dx, dy);
};

export class Snapper {
  constructor(opts = {}) {
    this.tau = opts.tau ?? 220; // ms for a vote to fade to 1/e
    this.switchRatio = opts.switchRatio ?? 1.4;
    this.votes = new Map();
    this.current = null;
    this.last = null;
    this.lastT = null;
    this.offset = { x: 0, y: 0 };
    this.why = "";
  }
  /** Corrects a raw point by the learned drift offset. */
  correct(p) {
    return { x: p.x + this.offset.x, y: p.y + this.offset.y };
  }
  /**
   * One sample: `p` is the filtered point, `jitter` its recent spread in pixels, `targets` [{id, rect}].
   * Returns the highlighted target id (or null) and sets `why` to the reason when the highlight did not move.
   */
  sample(raw, jitter, t, targets) {
    const p = this.correct(raw);
    const sigma = Math.min(130, Math.max(24, jitter * 1.3));
    if (this.lastT !== null) {
      const k = Math.exp(-(t - this.lastT) / this.tau);
      for (const [id, v] of this.votes) {
        const nv = v * k;
        if (nv < 1e-3) this.votes.delete(id);
        else this.votes.set(id, nv);
      }
    }
    // A sudden jump (a saccade to somewhere new) clears the old votes so the new place wins quickly.
    if (this.last && Math.hypot(p.x - this.last.x, p.y - this.last.y) > Math.max(4 * sigma, 180)) {
      this.votes.clear();
      this.why = "jump: old votes cleared";
    }
    this.last = p;
    this.lastT = t;
    let near = 0;
    for (const tg of targets) {
      const d = distToRect(p, tg.rect);
      if (d > 3 * sigma) continue;
      near++;
      this.votes.set(tg.id, (this.votes.get(tg.id) ?? 0) + Math.exp(-(d * d) / (2 * sigma * sigma)));
    }
    if (!near) {
      this.why = "no control near the point";
      return this.current;
    }
    let best = null, bestV = 0;
    for (const [id, v] of this.votes) if (v > bestV) (best = id), (bestV = v);
    const curV = this.current ? this.votes.get(this.current) ?? 0 : 0;
    if (best !== this.current && bestV > curV * this.switchRatio + 0.05) {
      this.current = best;
      this.why = "";
    } else if (best !== this.current) this.why = "another control is close but not clearly ahead";
    else this.why = "";
    return this.current;
  }
  /** A confirmed click: the person was looking at `rect`; nudge the drift offset toward its centre. */
  confirm(raw, rect) {
    const p = this.correct(raw);
    const cx = (rect.left + rect.right) / 2, cy = (rect.top + rect.bottom) / 2;
    const clamp = (v) => Math.max(-160, Math.min(160, v));
    this.offset = { x: clamp(this.offset.x + 0.3 * (cx - p.x)), y: clamp(this.offset.y + 0.3 * (cy - p.y)) };
  }
  clear() {
    this.votes.clear();
    this.current = null;
    this.last = null;
  }
}

/**
 * Simulated gaze, for the camera-free demo and the published numbers: a person looking at each target in turn,
 * with Gaussian noise of `noisePx` and a fixed drift. Returns the share of fixations where the snapped highlight
 * landed on the intended target within `windowMs`.
 */
export function simulate({ size = 44, gap = 12, noisePx = 45, drift = { x: 18, y: -12 }, trials = 300, seed = 7, rows = 3, cols = 4 } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const targets = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const left = 100 + c * (size * 2 + gap), top = 100 + r * (size + gap);
    targets.push({ id: `t${r}${c}`, rect: { left, top, right: left + size * 2, bottom: top + size } });
  }
  const snap = new Snapper();
  let hit = 0, t = 0;
  for (let i = 0; i < trials; i++) {
    const goal = targets[Math.floor(rnd() * targets.length)];
    const cx = (goal.rect.left + goal.rect.right) / 2, cy = (goal.rect.top + goal.rect.bottom) / 2;
    let got = null;
    for (let k = 0; k < 18; k++) { // 18 frames ≈ 600 ms at 30 fps
      t += 33;
      got = snap.sample({ x: cx + drift.x + gauss() * noisePx, y: cy + drift.y + gauss() * noisePx }, noisePx, t, targets);
    }
    if (got === goal.id) {
      hit++;
      snap.confirm({ x: cx + drift.x, y: cy + drift.y }, goal.rect);
    }
    t += 400;
  }
  return Math.round((1000 * hit) / trials) / 10;
}

// ---- Voice commands, in four languages. Stop is decided here, in code, never by a model ----

const fold = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[.,!?¿¡"'“”।]/g, " ").replace(/\s+/g, " ").trim();

export const WORDS = {
  wake: ["peek", "peak", "pick", "pique", "peke", "pik", "pīk", "पीक", "पिक"],
  stop: ["stop", "halt", "ruko", "rukho", "rukiye", "roko", "band karo", "रुको", "रुकिए", "रोको", "बंद करो", "स्टॉप", "berhenti", "henti", "stop dulu", "pare", "parar", "chega"],
  click: ["click", "klik", "clique", "clicar", "tekan", "pilih ini", "dabao", "दबाओ", "क्लिक", "this one", "that one", "select", "press", "open", "yang ini", "ini", "este", "esse", "isso", "यह वाला", "ये वाला", "ise", "isse"],
  yes: ["yes", "yeah", "yep", "confirm", "haan", "ha", "han", "ji haan", "हाँ", "हां", "जी हाँ", "ya", "iya", "betul", "sim", "confirmo", "confirmar"],
  no: ["no", "nope", "cancel", "nahin", "nahi", "na", "नहीं", "नही", "tidak", "bukan", "jangan", "batal", "nao", "não", "cancelar"],
  down: ["scroll down", "down", "neeche", "niche", "नीचे", "turun", "gulir ke bawah", "bawah", "descer", "rolar para baixo", "para baixo"],
  up: ["scroll up", "up", "upar", "ऊपर", "naik", "gulir ke atas", "atas", "subir", "rolar para cima", "para cima"],
  back: ["go back", "back", "peeche", "wapas", "वापस", "kembali", "voltar"],
  reorder: ["reorder this", "reorder", "order this again", "order again", "order the same again", "repeat this order", "phir se order", "fir se order", "dobara order", "फिर से ऑर्डर", "दोबारा ऑर्डर", "pesan lagi", "pesan ulang", "pedir de novo", "pedir novamente", "repetir pedido", "refazer pedido"],
};

const has = (text, list) => list.some((w) => { const f = fold(w); return text === f || text.startsWith(f + " ") || text.endsWith(" " + f) || text.includes(" " + f + " "); });

function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Strips a fuzzy wake word ("Peek", "Peak" …) from the start. Returns {woke, rest}. */
export function wake(text) {
  const t = fold(text);
  const [first, ...rest] = t.split(" ");
  const woke = WORDS.wake.some((w) => lev(first ?? "", fold(w)) <= (fold(w).length > 3 ? 1 : 0));
  return { woke, rest: woke ? rest.join(" ") : t };
}

/**
 * Parses one utterance. `requireWake` asks for the wake word before anything but stop, yes/no on an open confirm
 * card, and a bare "click". Returns {kind, name?} where kind is stop | yes | no | click | press | reorder | down |
 * up | back | none.
 */
export function parse(text, { requireWake = true, confirming = false, pushToTalk = false } = {}) {
  const { woke, rest } = wake(text);
  const t = rest;
  if (!t) return { kind: "none", why: woke ? "wake word only" : "empty" };
  if (has(t, WORDS.stop)) return { kind: "stop" };
  if (confirming) {
    if (has(t, WORDS.no)) return { kind: "no" };
    if (has(t, WORDS.yes)) return { kind: "yes" };
    return { kind: "none", why: "waiting for yes or no" };
  }
  const listening = woke || pushToTalk || !requireWake;
  if (has(t, WORDS.reorder)) return listening ? { kind: "reorder" } : { kind: "none", why: "say Peek first" };
  // "press approve", "click Order the same again": a named control.
  const named = /^(?:press|click|klik|tekan|clique em|clicar em|dabao|open)\s+(.{2,60})$/.exec(t);
  const deictic = /^(this|that|this one|that one|it|ini|itu|yang ini|isso|este|esse|isto|यह|ये|इसे)$/;
  if (named && listening && !deictic.test(named[1])) return { kind: "press", name: named[1] };
  if (has(t, WORDS.click) && t.split(" ").length <= 3) return { kind: "click" };
  if (!listening) return { kind: "none", why: "say Peek first" };
  if (has(t, WORDS.down)) return { kind: "down" };
  if (has(t, WORDS.up)) return { kind: "up" };
  if (has(t, WORDS.back)) return { kind: "back" };
  return { kind: "none", why: "not a command" };
}

/** Best match among controls for a spoken name; null unless the match is clear. */
export function matchName(spoken, names) {
  const s = fold(spoken);
  let best = null, bestScore = 0;
  for (const n of names) {
    const f = fold(n.name);
    if (!f) continue;
    let score = 0;
    if (f === s) score = 1;
    else if (f.includes(s) || s.includes(f)) score = 0.8 * Math.min(f.length, s.length) / Math.max(f.length, s.length) + 0.15;
    else score = 1 - lev(s, f) / Math.max(s.length, f.length);
    if (score > bestScore) (best = n), (bestScore = score);
  }
  return bestScore >= 0.6 ? best : null;
}

// ---- Which actions need a confirm card (enforced in code, not by asking a model) ----

const SENSITIVE = /\b(pay|paid|payment|approve|approval|capture|charge|refund|release|delete|remove|cancel|send|dispute|confirm|accept|place (?:the )?hold|hold \$|authori[sz]e|void|transfer|reorder|order the same again|repeat this order|reject|sign the|settle|submit|agree)\b/i;

/** True when activating a control with this (English) name could move money, send, delete, cancel or dispute. */
export function sensitive(name, el = {}) {
  if (el.confirm === "no") return false;
  if (el.confirm === "yes") return true;
  if (el.type === "submit" && el.formMethod === "post") return true;
  return SENSITIVE.test(String(name ?? ""));
}
