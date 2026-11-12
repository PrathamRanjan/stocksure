// Look and Say: hands-free control by head, gaze and voice, for every StockSure page (the React app and the
// server pages). Off until the person turns it on. The camera is read on this device only: frames go to
// MediaPipe's face model running in this tab and are never uploaded. Mouse, touch and keyboard always work and
// take over the moment they move. Anything that moves money, sends, cancels, deletes or disputes opens a confirm
// card first, and only a spoken "yes" or a real click on Yes goes ahead; that rule is code here, not a prompt.
import * as core from "./core.js";

const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const PREFS = "ls-prefs";
const CALIB = "ls-calib";
const SPEECH_LANG = { en: "en-US", "hi-IN": "hi-IN", "id-ID": "id-ID", "pt-BR": "pt-BR" };
const T = (s) => (window.ssI18n?.t ? window.ssI18n.t(s) : s);
const lang = () => window.ssI18n?.lang || "en";
const now = () => performance.now();
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k) || "null") ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: settings last this visit only */ } },
};

const prefs = { mode: "head", dwell: false, dwellMs: 1100, wink: false, requireWake: true, speak: true, share: false, ...store.get(PREFS, {}) };
const savePrefs = () => store.set(PREFS, prefs);

const S = {
  on: false, cam: false, voice: false, stopped: null, away: false, pausedUntil: 0,
  video: null, stream: null, lm: null, raf: 0, lastVideoT: -1,
  model: { gaze: null, head: null }, base: null, neutral: null, calibrating: false,
  fx: new core.OneEuro(0.8, 0.015), fy: new core.OneEuro(0.8, 0.015), raw: [], hist: [], point: null,
  snap: new core.Snapper(), targets: new Map(), ids: new WeakMap(), nextId: 1, highlight: null, hlSince: 0, dwellDone: null,
  noFaceSince: null, shiftSince: null, shiftOffered: false, winkSince: null, winkLatched: false,
  rec: null, ptt: false, pttUntil: 0, meter: null, lastVoiced: 0, floor: 0.004, levels: [], speaking: "", speakingUntil: 0,
  confirm: null, log: [], fps: 0, frames: 0, fpsT: 0,
};

// ---------- UI ----------
let bar, ring, dot, live, dbg, card;
function el(tag, attrs = {}, kids = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids) e.append(c);
  return e;
}
function ui() {
  if (bar) return;
  live = el("div", { class: "ls-live", "aria-live": "polite", role: "status" });
  ring = el("div", { class: "ls-ring", "aria-hidden": "true" }, [el("span", { class: "ls-ring-fill" })]);
  dot = el("div", { class: "ls-dot", "aria-hidden": "true" });
  dbg = el("pre", { class: "ls-debug", hidden: true, "aria-label": "Hands-free debug log" });
  bar = el("div", { class: "ls-bar", role: "region", "aria-label": "Hands-free controls", "data-ls-ui": "" });
  document.body.append(ring, dot, bar, live, dbg);
  renderBar();
}
function renderBar() {
  if (!bar) return;
  bar.replaceChildren();
  bar.hidden = !S.on;
  if (!S.on) return;
  const btn = (label, on, extra = {}) => el("button", { type: "button", class: "ls-btn", onclick: on, ...extra, text: T(label) });
  const camState = S.cam ? el("span", { class: "ls-cam on", text: T("Camera on, on this device only") }) : el("span", { class: "ls-cam", text: prefs.mode === "voice" ? T("Voice only, no camera") : T("Camera off") });
  if (S.video && S.cam) bar.append(S.video);
  bar.append(camState);
  if (S.cam) bar.append(btn("Turn camera off", () => setMode("voice")));
  const sel = el("select", { class: "ls-select", "aria-label": T("Pointer mode"), onchange: (e) => setMode(e.target.value) });
  for (const [v, l] of [["head", "Head pointing"], ["gaze", "Eye gaze"], ["voice", "Voice only"]]) sel.append(el("option", { value: v, selected: prefs.mode === v, text: T(l) }));
  bar.append(sel);
  if (prefs.mode !== "voice") bar.append(btn("Calibrate", () => calibrate("full")));
  bar.append(btn(prefs.dwell ? "Dwell click: on" : "Dwell click: off", () => { prefs.dwell = !prefs.dwell; savePrefs(); renderBar(); }, { "aria-pressed": String(prefs.dwell) }));
  if (hasSpeech()) {
    const ptt = btn(S.ptt ? "Listening…" : "Hold to talk", () => {}, { "aria-pressed": String(S.ptt), class: "ls-btn ls-ptt" });
    const down = () => { S.ptt = true; S.pttUntil = Infinity; ptt.textContent = T("Listening…"); };
    const up = () => { S.pttUntil = Date.now() + 1500; S.ptt = false; ptt.textContent = T("Hold to talk"); };
    ptt.addEventListener("pointerdown", down);
    ptt.addEventListener("pointerup", up);
    ptt.addEventListener("pointerleave", () => S.ptt && up());
    bar.append(ptt);
  }
  if (S.stopped) bar.append(btn("Resume", () => resume("button")));
  bar.append(btn(dbg.hidden ? "Debug" : "Hide debug", () => { dbg.hidden = !dbg.hidden; renderBar(); }));
  bar.append(btn("Close hands-free", () => toggle(false)));
}
function say(text, { speak = false } = {}) {
  if (!live) return;
  live.textContent = "";
  setTimeout(() => (live.textContent = text), 20);
  if (speak && prefs.speak && "speechSynthesis" in window) {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_LANG[lang()] || "en-US";
    const v = pickVoice(u.lang);
    if (v) u.voice = v;
    S.speaking = text;
    S.speakingUntil = Date.now() + 600 + text.length * 80;
    u.onend = () => (S.speakingUntil = Date.now() + 300);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }
}
/** A natural-sounding voice for the language when the device has one. */
export function pickVoice(tag) {
  const vs = ("speechSynthesis" in window ? speechSynthesis.getVoices() : []).filter((v) => v.lang?.replace("_", "-").toLowerCase().startsWith(tag.slice(0, 2).toLowerCase()));
  const exact = vs.filter((v) => v.lang.replace("_", "-").toLowerCase() === tag.toLowerCase());
  const pool = exact.length ? exact : vs;
  return pool.find((v) => /natural|neural|premium|enhanced|google/i.test(v.name)) || pool[0] || null;
}
function note(why) {
  if (!why) return;
  const t = new Date().toISOString().slice(11, 23);
  if (S.log[0]?.why === why) S.log[0].n++;
  else S.log.unshift({ t, why, n: 1 });
  S.log.length = Math.min(S.log.length, 40);
}
function drawDebug() {
  if (!dbg || dbg.hidden) return;
  const m = prefs.mode;
  dbg.textContent = [
    `mode ${m} · ${S.fps} fps · jitter ${Math.round(jitter())} px · offset ${Math.round(S.snap.offset.x)},${Math.round(S.snap.offset.y)}`,
    `calibration: gaze ${S.model.gaze?.check_px ?? "—"} px, head ${S.model.head?.check_px ?? "—"} px · noise floor ${S.floor.toFixed(4)}`,
    "why the pointer did or didn't move (newest first):",
    ...S.log.slice(0, 14).map((l) => `${l.t}  ${l.why}${l.n > 1 ? ` ×${l.n}` : ""}`),
  ].join("\n");
}

// ---------- targets ----------
const SEL = 'a[href],button,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],input:not([type=hidden]),select,textarea,summary,[tabindex]:not([tabindex="-1"])';
function idOf(e) {
  let id = S.ids.get(e);
  if (!id) S.ids.set(e, (id = `t${S.nextId++}`));
  return id;
}
function collect() {
  S.targets.clear();
  const W = innerWidth, H = innerHeight;
  const modal = document.querySelector("#ls-confirm, [role=dialog][data-state=open], [role=alertdialog][data-state=open]");
  for (const e of document.querySelectorAll(SEL)) {
    if (e.closest("[data-ls-skip]")) continue;
    if (modal && !modal.contains(e) && !e.closest("[data-ls-ui]")) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) continue;
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.pointerEvents === "none" || Number(cs.opacity) === 0) continue;
    S.targets.set(idOf(e), { el: e, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  }
}
export function accName(e) {
  const lab = e.getAttribute("aria-label");
  if (lab) return lab.trim();
  const by = e.getAttribute("aria-labelledby");
  if (by) return by.split(/\s+/).map((i) => document.getElementById(i)?.textContent ?? "").join(" ").trim();
  if (e.labels?.[0]) return e.labels[0].textContent.trim();
  const t = (e.innerText || e.textContent || "").replace(/\s+/g, " ").trim();
  return t || e.getAttribute("title") || e.getAttribute("placeholder") || e.value || e.querySelector?.("img[alt]")?.alt || "";
}
/** The English name, for the confirm rule: the translation layer keeps the original text. */
const englishName = (e) => (window.ssI18n?.original ? window.ssI18n.original(e) : null) || e.getAttribute("data-ls-name") || accName(e);

// ---------- activation ----------
function isDisabled(e) {
  return e.disabled || e.getAttribute("aria-disabled") === "true" || !!e.closest("fieldset[disabled]");
}
function amountNear(e) {
  const own = e.closest("[data-ls-amount]");
  if (own) return { amount: own.getAttribute("data-ls-amount"), to: own.getAttribute("data-ls-to") || null, exact: true };
  let n = e, hops = 0;
  while (n && hops++ < 5) {
    const m = /[−-]?(?:US)?\$\s?\d[\d.,]*/.exec(n.innerText || "");
    if (m) return { amount: m[0], to: e.closest("[data-ls-to]")?.getAttribute("data-ls-to") || null, exact: false };
    n = n.parentElement;
  }
  return { amount: null, to: null, exact: false };
}
function press(e) {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName) && !/^(button|submit|checkbox|radio|reset)$/.test(e.type)) {
    e.focus();
    say(`${T("Ready to type in")}: ${accName(e)}`);
    return;
  }
  const r = e.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window };
  e.dispatchEvent(new PointerEvent("pointerdown", { ...o, buttons: 1 }));
  e.dispatchEvent(new MouseEvent("mousedown", { ...o, buttons: 1 }));
  e.focus?.({ preventScroll: true });
  e.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 }));
  e.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 }));
  e.click();
}
/** Activates a control the person chose by look, voice or wink. `via` is dwell | voice | wink | name. */
function activate(e, via) {
  if (!e || !e.isConnected) return;
  const name = accName(e);
  if (isDisabled(e)) return say(`${T("That button is turned off")}: ${name}`, { speak: true });
  const role = e.getAttribute("role");
  const on = e.getAttribute("aria-selected") === "true" || (role === "radio" && e.getAttribute("aria-checked") === "true") || (e.type === "radio" && e.checked);
  if (on) return say(`${T("Already selected")}: ${name}`, { speak: via !== "dwell" });
  const before = S.hist.find((h) => h.t <= now() - 150) ?? S.hist[S.hist.length - 1];
  const r = e.getBoundingClientRect();
  if (before) S.snap.confirm(before.p, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  const form = e.form || e.closest?.("form");
  const meta = { type: e.type, formMethod: (form?.getAttribute("method") || "").toLowerCase(), confirm: e.getAttribute("data-ls-confirm") };
  // PayPal's approval page is another site this module can't drive: hand over clearly (spec A7.1).
  const toPayPal = /paypal\.com/i.test(e.getAttribute("href") || "") || /connect paypal|approve on paypal|pay with paypal|link paypal/i.test(englishName(e));
  const go = () => {
    if (toPayPal) say(T("Approve on PayPal's page; I'll wait here."), { speak: true });
    press(e);
  };
  if (core.sensitive(englishName(e), meta)) return openConfirm(e, name, via, go);
  go();
}

// ---------- the confirm card ----------
function openConfirm(target, name, via, run = () => press(target)) {
  closeConfirm(false);
  const { amount, to, exact } = amountNear(target);
  const yes = el("button", { type: "button", class: "ls-btn ls-yes", text: T("Yes, go ahead") });
  const no = el("button", { type: "button", class: "ls-btn", text: T("No") });
  card = el("div", { id: "ls-confirm", role: "alertdialog", "aria-modal": "true", "aria-labelledby": "ls-confirm-h", "data-ls-ui": "" }, [
    el("h2", { id: "ls-confirm-h", text: `${T("Confirm")}: ${name}` }),
    el("p", { text: amount ? `${T(exact ? "Amount" : "Amount shown nearby")}: ${amount}` : T("No amount is shown on this button.") }),
    el("p", { text: to ? `${T("To")}: ${to}` : T("Check the recipient on the page before you say yes.") }),
    el("p", { class: "ls-small", text: T("Say “yes” or click Yes to go ahead. Say “no” or “stop” to cancel. Looking at Yes does not count.") }),
    el("div", { class: "ls-row" }, [yes, no]),
  ]);
  // Only a real click (a trusted event) or a spoken yes confirms; a dwell or a wink on Yes does not.
  yes.addEventListener("click", (ev) => (ev.isTrusted || S.confirm?.voiceYes ? decide(true, "click") : say(T("Say yes, or click Yes with the mouse."))));
  no.addEventListener("click", () => decide(false, "click"));
  document.body.append(card);
  no.focus();
  S.confirm = { run, name, timer: setTimeout(() => decide(false, "timeout"), 30000), via };
  say(`${T("Confirm")}: ${name}${amount ? `, ${amount}` : ""}. ${T("Say yes or no.")}`, { speak: true });
}
function decide(ok, how) {
  const c = S.confirm;
  if (!c) return;
  closeConfirm(false);
  if (ok) {
    say(`${T("Going ahead")}: ${c.name}`);
    c.run();
  } else say(how === "timeout" ? T("Cancelled: no answer in 30 seconds.") : T("Cancelled. Nothing was done."), { speak: true });
}
function closeConfirm(announce) {
  if (S.confirm) clearTimeout(S.confirm.timer);
  S.confirm = null;
  card?.remove();
  card = null;
  if (announce) say(T("Cancelled. Nothing was done."));
}

// ---------- stop, pause, resume ----------
function stopAll(reason) {
  S.stopped = reason;
  closeConfirm(false);
  S.snap.clear();
  S.highlight = null;
  S.dwellDone = null;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  hideRing();
  say(reason === "look-away" ? T("Stopped: you looked away. Look back to carry on.") : T("Stopped. Say Peek, or press Resume, to carry on."), { speak: reason !== "look-away" });
  renderBar();
}
function resume(how) {
  if (!S.stopped) return;
  S.stopped = null;
  say(T("Hands-free is back on."));
  note(`resumed by ${how}`);
  renderBar();
}
function onRealInput(ev) {
  if (!S.on || !ev.isTrusted || ev.target?.closest?.("[data-ls-ui]")) return;
  if (ev.type === "pointermove" && Math.hypot(ev.movementX || 0, ev.movementY || 0) < 3) return;
  if (S.pausedUntil < now()) note("paused: a real mouse, trackpad or touch moved");
  S.pausedUntil = now() + 3000;
  hideRing();
}
function onKey(ev) {
  if (ev.altKey && ev.shiftKey && (ev.key === "H" || ev.key === "h" || ev.code === "KeyH")) {
    ev.preventDefault();
    toggle();
    return;
  }
  if (!S.on) return;
  if (ev.key === "Escape") {
    if (S.calibrating) return;
    stopAll("escape");
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? "") || document.activeElement?.isContentEditable;
  if (ev.key === "`" && !typing && !ev.repeat) (S.ptt = true), (S.pttUntil = Infinity);
}
function onKeyUp(ev) {
  if (ev.key === "`" && S.ptt) (S.ptt = false), (S.pttUntil = Date.now() + 1500);
}

// ---------- the highlight ring ----------
function showRing(t, progress) {
  const r = t.rect;
  Object.assign(ring.style, { display: "block", left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.right - r.left + 8}px`, height: `${r.bottom - r.top + 8}px` });
  ring.style.setProperty("--p", String(progress));
  ring.classList.toggle("dwell", progress > 0);
}
function hideRing() {
  if (ring) ring.style.display = "none";
  if (dot) dot.style.display = "none";
}

// ---------- the camera loop ----------
async function loadModel() {
  if (S.lm) return S.lm;
  const vision = await import(/* @vite-ignore */ `${VISION}/vision_bundle.mjs`);
  const files = await vision.FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  S.lm = await vision.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1, outputFaceBlendshapes: true });
  return S.lm;
}
async function startCamera() {
  if (S.cam) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    say(T("This browser has no camera access. Voice only is on."));
    return false;
  }
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
  } catch {
    say(T("No camera, or camera access was refused. Voice only is on; the mouse and keyboard still work."), { speak: true });
    return false;
  }
  S.video = el("video", { class: "ls-video", muted: true, playsinline: true, autoplay: true, "aria-label": T("Your camera, shown only to you") });
  S.video.srcObject = S.stream;
  await S.video.play().catch(() => undefined);
  try {
    say(T("Loading the face model, on this device…"));
    await loadModel();
  } catch {
    stopCamera();
    say(T("The face model could not load (offline?). Voice only is on."), { speak: true });
    return false;
  }
  S.cam = true;
  S.fx.reset();
  S.fy.reset();
  renderBar();
  loop();
  return true;
}
function stopCamera() {
  cancelAnimationFrame(S.raf);
  S.stream?.getTracks().forEach((t) => t.stop());
  S.stream = null;
  S.video?.remove();
  S.video = null;
  S.cam = false;
  hideRing();
}
const jitter = () => {
  const r = S.raw.slice(-15);
  if (r.length < 3) return 40;
  const mx = r.reduce((a, p) => a + p.x, 0) / r.length, my = r.reduce((a, p) => a + p.y, 0) / r.length;
  return Math.sqrt(r.reduce((a, p) => a + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / r.length);
};
/** Latest face reading, for calibration. */
let lastF = null;
function predict(f) {
  const m = prefs.mode === "gaze" ? S.model.gaze ?? S.model.head : S.model.head;
  if (m) return m.predict(f);
  // Not calibrated yet: point from the head, around the pose held when hands-free started.
  const n = S.neutral ?? f;
  return { x: innerWidth / 2 - (f.yaw - n.yaw) * innerWidth * 2.4, y: innerHeight / 2 + (f.pitch - n.pitch) * innerHeight * 3.2 };
}
let lastCollect = 0;
function loop() {
  S.raf = requestAnimationFrame(loop);
  const v = S.video;
  if (!v || v.readyState < 2 || v.currentTime === S.lastVideoT) return;
  S.lastVideoT = v.currentTime;
  const t = now();
  S.frames++;
  if (t - S.fpsT > 1000) (S.fps = S.frames), (S.frames = 0), (S.fpsT = t), drawDebug();
  let res;
  try {
    res = S.lm.detectForVideo(v, t);
  } catch {
    return note("face model error on this frame");
  }
  const lm = res?.faceLandmarks?.[0];
  if (!lm) {
    S.noFaceSince ??= t;
    note("no face in view");
    if (t - S.noFaceSince > 2000 && !S.away && !S.calibrating) {
      S.away = true;
      stopAll("look-away");
    }
    hideRing();
    return;
  }
  S.noFaceSince = null;
  const f = core.features(lm, v.videoWidth / (v.videoHeight || 1));
  if (!f) return note("face found but eyes not readable");
  lastF = f;
  if (S.away) {
    S.away = false;
    if (S.stopped === "look-away") resume("looking back");
  }
  S.neutral ??= f;
  const e = core.eyes(res.faceBlendshapes?.[0]?.categories);
  if (e.blink) return note("blink: point frozen");
  if (prefs.wink && !S.calibrating) winkCheck(e, t);
  if (S.calibrating) return;
  if (S.stopped) return note(`stopped (${S.stopped})`);
  if (S.pausedUntil > t) return note("paused: a real mouse, trackpad or touch moved");
  const p0 = predict(f);
  S.raw.push(p0);
  if (S.raw.length > 30) S.raw.shift();
  const p = { x: S.fx.filter(p0.x, t), y: S.fy.filter(p0.y, t) };
  S.point = p;
  S.hist.push({ t, p });
  while (S.hist.length && S.hist[0].t < t - 400) S.hist.shift();
  if (t - lastCollect > 350) (collect(), (lastCollect = t));
  const list = [...S.targets].map(([id, x]) => ({ id, rect: x.rect }));
  const pc = S.snap.correct(p);
  Object.assign(dot.style, { display: "block", left: `${pc.x - 5}px`, top: `${pc.y - 5}px` });
  const prev = S.highlight;
  const id = S.snap.sample(p, jitter(), t, list);
  if (S.snap.why) note(S.snap.why);
  if (!id || !S.targets.has(id)) return hideRingOnly();
  if (id !== prev) (S.highlight = id), (S.hlSince = t), (S.dwellDone = null);
  const tg = S.targets.get(id);
  let progress = 0;
  if (prefs.dwell && S.dwellDone !== id && !S.confirm) {
    progress = Math.min(1, (t - S.hlSince) / prefs.dwellMs);
    if (progress >= 1) {
      S.dwellDone = id;
      activate(tg.el, "dwell");
      progress = 0;
    }
  }
  showRing(tg, progress);
  headShiftCheck(f, t);
}
function hideRingOnly() {
  if (ring) ring.style.display = "none";
}
function winkCheck(e, t) {
  const th = store.get(CALIB, {})?.wink ?? { shut: 0.55, open: 0.3 };
  const one = (e.left > th.shut && e.right < th.open) || (e.right > th.shut && e.left < th.open);
  if (!one) {
    S.winkSince = null;
    if (e.left < th.open && e.right < th.open) S.winkLatched = false;
    return;
  }
  S.winkSince ??= t;
  if (!S.winkLatched && t - S.winkSince > 200 && S.highlight && S.targets.has(S.highlight) && !S.stopped) {
    S.winkLatched = true;
    note("wink: click");
    activate(S.targets.get(S.highlight).el, "wink");
  }
}
function headShiftCheck(f, t) {
  if (!S.base || S.shiftOffered) return;
  if (core.headShifted(S.base, f)) {
    S.shiftSince ??= t;
    if (t - S.shiftSince > 2000) {
      S.shiftOffered = true;
      const b = el("button", { type: "button", class: "ls-btn", text: T("Top up with 3 dots"), onclick: () => (b.remove(), calibrate("topup")) });
      bar.append(b);
      say(T("You have moved since calibrating. Top up with 3 dots for a steadier pointer."));
    }
  } else S.shiftSince = null;
}

// ---------- calibration ----------
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runDots(points, label, settle = 500, collectMs = 800) {
  const ov = document.getElementById("ls-calib");
  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (!S.calibrating) return null;
    const [fx, fy] = points[i];
    const x = fx * innerWidth, y = fy * innerHeight;
    const d = ov.querySelector(".ls-cdot");
    Object.assign(d.style, { left: `${x - 14}px`, top: `${y - 14}px` });
    ov.querySelector(".ls-ctext").textContent = `${T(label)} ${i + 1} / ${points.length}`;
    await wait(settle);
    const end = now() + collectMs;
    let last = null;
    while (now() < end) {
      if (lastF && lastF !== last) {
        out.push({ dot: `${label}${i}`, x, y, f: lastF });
        last = lastF;
      }
      await wait(30);
    }
  }
  return out;
}
async function calibrate(kind) {
  if (!S.cam && !(await startCamera())) return;
  S.calibrating = true;
  hideRing();
  const ov = el("div", { id: "ls-calib", role: "dialog", "aria-modal": "true", "aria-label": T("Calibration"), "data-ls-ui": "" }, [
    el("div", { class: "ls-cdot", "aria-hidden": "true" }),
    el("p", { class: "ls-ctext", "aria-live": "polite" }),
    el("p", { class: "ls-chelp", text: T("Look at each dot until it moves. Keep your head still for eye gaze; turn your head for head pointing. Press Esc to cancel.") }),
  ]);
  const cancel = (ev) => ev.key === "Escape" && (S.calibrating = false);
  addEventListener("keydown", cancel);
  document.body.append(ov);
  try {
    const saved = store.get(CALIB, null);
    if (kind === "topup" && saved?.samples?.length) {
      const pts = await runDots(core.DOTS.topup, "Dot");
      if (!pts) return;
      const m = (prefs.mode === "gaze" ? S.model.gaze : S.model.head) ?? S.model.head;
      if (m) {
        const dx = [], dy = [];
        for (const s of pts) {
          const q = m.predict(s.f);
          dx.push(s.x - q.x);
          dy.push(s.y - q.y);
        }
        const med = (a) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
        S.snap.offset = { x: med(dx), y: med(dy) };
      }
      S.base = lastF;
      S.shiftOffered = false;
      say(T("Topped up."), { speak: true });
      return;
    }
    const samples = await runDots(core.DOTS.calibrate, "Dot");
    if (!samples) return say(T("Calibration cancelled."));
    const checks = await runDots(core.DOTS.check, "Check dot");
    if (!checks) return say(T("Calibration cancelled."));
    const result = fitAll(samples, checks);
    if (!result) return say(T("Your face wasn't seen clearly enough. Try more light, or move closer."), { speak: true });
    const winkTh = prefs.wink ? await calibrateWink(ov) : saved?.wink;
    store.set(CALIB, { at: new Date().toISOString(), w: innerWidth, h: innerHeight, samples, checks, wink: winkTh ?? null, base: lastF });
    S.base = lastF;
    showResult(result);
  } finally {
    removeEventListener("keydown", cancel);
    ov.remove();
    S.calibrating = false;
    S.snap.clear();
    renderBar();
  }
}
async function calibrateWink(ov) {
  const read = async (label) => {
    ov.querySelector(".ls-ctext").textContent = T(label);
    await wait(900);
    const v = [];
    const end = now() + 900;
    while (now() < end) {
      const res = S.lm.detectForVideo(S.video, now());
      const e = core.eyes(res?.faceBlendshapes?.[0]?.categories);
      v.push(Math.max(e.left, e.right));
      await wait(40);
    }
    return v.sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? 0;
  };
  const open = await read("Both eyes open");
  const shut = await read("Now close one eye and hold");
  if (shut - open < 0.25) return null;
  return { open: open + (shut - open) * 0.3, shut: open + (shut - open) * 0.6 };
}
function fitAll(samples, checks) {
  const iris = samples.some((s) => s.f.iris);
  const head = core.fit(samples, "head");
  const gaze = iris ? core.fit(samples, "gaze") : null;
  if (!head && !gaze) return null;
  if (head) head.check_px = core.accuracy(head, checks);
  if (gaze) gaze.check_px = core.accuracy(gaze, checks);
  S.model = { head, gaze };
  const mode = core.chooseMode(gaze?.check_px ?? Infinity, head?.check_px ?? Infinity);
  return { head: head?.check_px ?? null, gaze: gaze?.check_px ?? null, mode };
}
function showResult(r) {
  prefs.mode = r.mode;
  savePrefs();
  const lines = [
    `${T("Eye gaze")}: ${r.gaze ?? "—"} px · ${T("Head pointing")}: ${r.head ?? "—"} px ${T("on dots it had not seen")}.`,
    r.mode === "gaze" ? T("Eye gaze is accurate enough here; using it.") : T("Head pointing is steadier here; using it. You can switch in the bar."),
  ];
  const share = el("input", { type: "checkbox", id: "ls-share", checked: prefs.share });
  const box = el("div", { id: "ls-confirm", role: "dialog", "aria-modal": "true", "aria-labelledby": "ls-res-h", "data-ls-ui": "" }, [
    el("h2", { id: "ls-res-h", text: T("Calibration result") }),
    ...lines.map((l) => el("p", { text: l })),
    el("label", { class: "ls-small", for: "ls-share" }, [share, document.createTextNode(" " + T("Share these two numbers, and nothing else, on the public accessibility page."))]),
    el("div", { class: "ls-row" }, [el("button", { type: "button", class: "ls-btn ls-yes", text: T("Done"), onclick: () => {
      prefs.share = share.checked;
      savePrefs();
      if (share.checked) fetch("/api/public/handsfree", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gaze_px: r.gaze, head_px: r.head, mode: r.mode, w: innerWidth, h: innerHeight }) }).catch(() => undefined);
      box.remove();
    } })]),
  ]);
  document.body.append(box);
  box.querySelector("button").focus();
  say(lines.join(" "), { speak: true });
}
function restoreCalibration() {
  const c = store.get(CALIB, null);
  if (!c?.samples?.length) return false;
  if (Math.abs(c.w / innerWidth - 1) > 0.15 || Math.abs(c.h / innerHeight - 1) > 0.15) return false;
  const sx = innerWidth / c.w, sy = innerHeight / c.h;
  const scale = (a) => a.map((s) => ({ ...s, x: s.x * sx, y: s.y * sy }));
  fitAll(scale(c.samples), scale(c.checks));
  S.base = c.base ?? null;
  return true;
}

// ---------- voice ----------
const hasSpeech = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
async function startVoice() {
  if (S.voice || !hasSpeech()) return;
  if (!navigator.onLine) say(T("Voice needs a connection. The pointer and dwell click still work."), { speak: false });
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = SPEECH_LANG[lang()] || "en-US";
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 2;
  rec.onresult = (ev) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const text = r[0].transcript;
      // "Stop" acts on the interim result too, so it cuts in fast.
      if (!r.isFinal) {
        if (core.parse(text, { requireWake: false }).kind === "stop") stopAll("voice");
        continue;
      }
      heard(text);
    }
  };
  rec.onerror = (ev) => {
    if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
      S.voice = false;
      say(T("Microphone access was refused. Dwell click and the mouse still work."));
    } else if (ev.error === "network") say(T("Voice needs a connection. The pointer and dwell click still work."));
    else if (ev.error !== "no-speech" && ev.error !== "aborted") note(`voice: ${ev.error}`);
  };
  rec.onend = () => {
    if (S.on && S.voice) setTimeout(() => S.on && S.voice && rec.start?.(), 250);
  };
  S.rec = rec;
  S.voice = true;
  try {
    rec.start();
  } catch {
    /* already started */
  }
  meterStart();
}
function stopVoice() {
  S.voice = false;
  try { S.rec?.stop(); } catch { /* not running */ }
  S.rec = null;
  S.meter?.stream.getTracks().forEach((t) => t.stop());
  S.meter?.ctx.close().catch(() => undefined);
  S.meter = null;
}
/** Noise gate: learns the room's level and notes when someone actually spoke above it. */
async function meterStart() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const ctx = new AudioContext();
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    S.meter = { stream, ctx };
    const tick = () => {
      if (!S.meter) return;
      an.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length);
      S.levels.push(rms);
      if (S.levels.length > 60) S.levels.shift();
      const sorted = [...S.levels].sort((a, b) => a - b);
      S.floor = Math.max(0.002, sorted[Math.floor(sorted.length * 0.2)] ?? 0.004);
      if (rms > Math.max(S.floor * 3, 0.008) && Date.now() > S.speakingUntil) S.lastVoiced = Date.now();
      setTimeout(tick, 50);
    };
    tick();
  } catch {
    S.lastVoiced = Infinity; // no meter: let every result through
  }
}
const overlap = (a, b) => {
  const A = new Set(a.toLowerCase().split(/\s+/)), B = b.toLowerCase().split(/\s+/);
  return B.length ? B.filter((w) => A.has(w)).length / B.length : 0;
};
function heard(text) {
  const ptt = S.ptt || Date.now() < S.pttUntil;
  const cmd = core.parse(text, { requireWake: prefs.requireWake, confirming: !!S.confirm, pushToTalk: ptt });
  // Stop and no only ever cancel, so they skip the echo and noise filters; an echoed "yes" from our own prompt is dropped.
  if (cmd.kind !== "stop" && !(cmd.kind === "no" && S.confirm)) {
    if (Date.now() < S.speakingUntil + 400 && overlap(S.speaking, text) > 0.5) return note(`voice: dropped our own voice ("${text}")`);
    if (S.meter && Date.now() - S.lastVoiced > 2500) return note(`noise gate: nothing above the room's level ("${text}")`);
  }
  note(`heard "${text}" → ${cmd.kind}${cmd.why ? ` (${cmd.why})` : ""}`);
  if (cmd.kind === "stop") return stopAll("voice");
  if (S.stopped && core.wake(text).woke) return resume("voice");
  if (S.stopped) return;
  if (cmd.kind === "yes" && S.confirm) {
    S.confirm.voiceYes = true;
    return decide(true, "voice");
  }
  if (cmd.kind === "no" && S.confirm) return decide(false, "voice");
  const hl = S.highlight && S.targets.get(S.highlight)?.el;
  if (cmd.kind === "click") return hl ? activate(hl, "voice") : say(T("Look at a button first, then say click."), { speak: true });
  if (cmd.kind === "press") {
    collect();
    const names = [...S.targets.values()].map((t) => ({ name: accName(t.el), el: t.el }));
    const m = core.matchName(cmd.name, names);
    return m ? activate(m.el, "name") : say(`${T("No button called")} “${cmd.name}”.`, { speak: true });
  }
  if (cmd.kind === "reorder") return reorder(hl);
  if (cmd.kind === "down") return scrollBy({ top: innerHeight * 0.6, behavior: "smooth" });
  if (cmd.kind === "up") return scrollBy({ top: -innerHeight * 0.6, behavior: "smooth" });
  if (cmd.kind === "back") return history.back();
}

/**
 * "Reorder this", said while looking at an order: StockSure's own reorder action for the order looked at (or the
 * one open on screen), behind the confirm card. A row in a list carries data-ls-reorder (its order id); on an order
 * page the "Order the same again" button carries data-ls-action="reorder".
 */
function reorder(hl) {
  const here = (hl && hl.closest("[data-ls-reorder]")) || null;
  const btn = (here || document).querySelector('[data-ls-action="reorder"]');
  if (btn && !isDisabled(btn)) return openConfirm(btn, accName(btn), "voice");
  const id = here?.getAttribute("data-ls-reorder");
  if (id) {
    const go = () => {
      try { sessionStorage.setItem("ls-pending", JSON.stringify({ action: "reorder", id, until: Date.now() + 15000 })); } catch { /* no storage */ }
      location.assign(`/po/${encodeURIComponent(id)}`);
    };
    return openConfirm(here, `${T("Open this order to reorder it")}: ${here.getAttribute("data-ls-name") || id}`, "voice", go);
  }
  say(T("Look at an order, then say reorder this."), { speak: true });
}
function pending() {
  let p = null;
  try { p = JSON.parse(sessionStorage.getItem("ls-pending") || "null"); sessionStorage.removeItem("ls-pending"); } catch { return; }
  if (!p || p.until < Date.now()) return;
  let tries = 0;
  const look = () => {
    const btn = document.querySelector('[data-ls-action="reorder"]');
    if (btn) return openConfirm(btn, accName(btn), "voice");
    if (tries++ < 20) setTimeout(look, 300);
    else say(T("This order can't be reordered here."));
  };
  look();
}

// ---------- on / off ----------
async function setMode(m) {
  prefs.mode = m;
  savePrefs();
  if (m === "voice") stopCamera();
  else if (S.on) {
    const ok = await startCamera();
    if (ok && !restoreCalibration()) say(T("Hands-free is on. Calibrate for a steadier pointer; until then, turn your head to point."), { speak: true });
  }
  renderBar();
}
export async function toggle(force) {
  const want = force ?? !S.on;
  if (want === S.on) return;
  ui();
  S.on = want;
  document.documentElement.classList.toggle("ls-on", want);
  dispatchEvent(new CustomEvent("lookandsay:change", { detail: { on: want } }));
  if (!want) {
    stopCamera();
    stopVoice();
    closeConfirm(false);
    S.stopped = null;
    renderBar();
    say(T("Hands-free is off."));
    return;
  }
  renderBar();
  say(T("Hands-free is on. Say stop, press Esc, or look away to stop it."));
  if (prefs.mode !== "voice") {
    const ok = await startCamera();
    if (!ok) prefs.mode = "voice";
    else if (restoreCalibration()) say(T("Welcome back. Your calibration from this device is loaded."));
    else say(T("Hands-free is on. Calibrate for a steadier pointer; until then, turn your head to point."));
  }
  startVoice();
  if (!hasSpeech() && prefs.mode !== "voice") {
    prefs.dwell = true;
    say(T("This browser has no speech recognition, so dwell click is on."));
  }
  renderBar();
}
function boot() {
  addEventListener("keydown", onKey, true);
  addEventListener("keyup", onKeyUp, true);
  for (const t of ["pointermove", "pointerdown", "touchstart", "wheel"]) addEventListener(t, onRealInput, { capture: true, passive: true });
  addEventListener("online", () => S.on && say(T("Back online. Voice works again.")));
  addEventListener("offline", () => S.on && say(T("Offline: voice is unavailable. The pointer and dwell click still work."), { speak: true }));
  addEventListener("ssi18n:change", () => {
    renderBar();
    if (S.rec) {
      S.rec.lang = SPEECH_LANG[lang()] || "en-US";
      try { S.rec.stop(); } catch { /* restarts in onend with the new language */ }
    }
  });
  document.addEventListener("click", (ev) => {
    const b = ev.target?.closest?.("[data-ls-toggle]");
    if (b) toggle();
  });
  // A page with no header button gets a small floating one.
  setTimeout(() => {
    if (!document.querySelector("[data-ls-toggle]")) {
      const b = el("button", { type: "button", class: "ls-fab", "data-ls-toggle": "", "data-ls-ui": "", "aria-label": T("Hands-free mode (Alt+Shift+H)"), text: T("Hands-free") });
      document.body.append(b);
    }
  }, 800);
  try {
    if (sessionStorage.getItem("ls-pending")) toggle(true).then(pending);
  } catch { /* no storage */ }
}

window.lookAndSay = { toggle, calibrate: () => calibrate("full"), get on() { return S.on; }, core, simulate: core.simulate, _state: S, _heard: heard };
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
