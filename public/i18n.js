// StockSure in four languages: English, हिन्दी, Bahasa Indonesia, Português (Brasil).
// One layer for every page, the React app and the server pages alike: each piece of English text the page shows
// is looked up in /static/i18n/<lang>.json and shown translated; the English stays underneath, so switching
// language is instant (no reload, nothing typed is lost) and code never depends on the translated words.
// Money keeps its currency (USD, the currency PayPal charges) and is formatted for the language. Text written by
// an AI (marked data-i18n-ai) is translated on the server on demand and labelled machine-translated.
(() => {
  const LANGS = {
    en: { name: "English", intl: "en-US", paypal: "en-US" },
    "hi-IN": { name: "हिन्दी", intl: "hi-IN", paypal: "en-IN" },
    "id-ID": { name: "Bahasa Indonesia", intl: "id-ID", paypal: "id-ID" },
    "pt-BR": { name: "Português (Brasil)", intl: "pt-BR", paypal: "pt-BR" },
  };
  const PSEUDO = "en-XA"; // pseudo-locale for testing: every known string is wrapped, so untranslated ones stand out
  const V = "1";
  const SKIP = "script,style,code,pre,kbd,samp,textarea,svg,noscript,[translate=no],.notranslate,[data-no-i18n],[contenteditable=true],.ag-cell,.ls-debug,[data-i18n-ai]";
  const ATTRS = ["placeholder", "aria-label", "title", "alt", "aria-description"];

  const norm = (l) => {
    if (!l) return null;
    const s = String(l).toLowerCase();
    if (s === "en-xa") return PSEUDO;
    if (s.startsWith("hi")) return "hi-IN";
    if (s.startsWith("id") || s.startsWith("in") || s === "ms" || s.startsWith("ms-")) return s.startsWith("ms") ? null : "id-ID";
    if (s.startsWith("pt")) return "pt-BR";
    if (s.startsWith("en")) return "en";
    return null;
  };
  const cookie = () => (/(?:^|;\s*)ss-lang=([^;]+)/.exec(document.cookie)?.[1] ?? null);
  function detect() {
    const q = new URLSearchParams(location.search).get("lang");
    if (norm(q)) return { lang: norm(q), from: "url" };
    let saved = null;
    try { saved = localStorage.getItem("ss-lang"); } catch { /* private window */ }
    if (norm(saved)) return { lang: norm(saved), from: "saved" };
    if (norm(cookie())) return { lang: norm(cookie()), from: "saved" };
    for (const l of navigator.languages || [navigator.language]) if (norm(l)) return { lang: norm(l), from: "browser" };
    return { lang: "en", from: "default" };
  }

  let lang = "en";
  let dict = null; // { exact: Map, templates: [{re, out}] }
  const cache = {};
  const orig = new WeakMap(); // Text node → its English
  const mine = new WeakMap(); // Text node → what this layer last wrote
  const origAttr = new WeakMap(); // Element → {attr: English}
  const mineAttr = new WeakMap();
  const misses = new Set();
  const aiDone = new WeakMap();

  const money = (s) => {
    if (lang === "en" || lang === PSEUDO) return s;
    const f = new Intl.NumberFormat(LANGS[lang].intl, { style: "currency", currency: "USD" });
    return s.replace(/([−-])?\$(\d{1,3}(?:,\d{3})*|\d+)(\.\d{1,2})?(?![\d,])/g, (_, neg, int, dec) => {
      const v = Number(int.replace(/,/g, "") + (dec || ""));
      return (neg ? "−" : "") + f.format(v);
    });
  };
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function compile(json) {
    const exact = new Map();
    const templates = [];
    for (const [k, v] of Object.entries(json.strings || {})) {
      if (!v) continue;
      if (/\{\d\}/.test(k)) {
        const parts = k.split(/(\{\d\})/);
        const order = [];
        const re = new RegExp("^" + parts.map((p) => (/^\{\d\}$/.test(p) ? (order.push(Number(p[1])), "(.+?)") : esc(p))).join("") + "$", "s");
        templates.push({ re, out: v, order, lit: k.replace(/\{\d\}/g, "").length });
      } else exact.set(k, v);
    }
    templates.sort((a, b) => b.lit - a.lit); // the most specific template wins
    return { exact, templates };
  }
  const pseudo = (s) => "⟦" + s.replace(/[a-z]/gi, (c) => ({ a: "á", e: "ë", i: "ï", o: "ô", u: "ü", A: "Å", E: "É", O: "Ø", c: "ç", n: "ñ" })[c] || c) + "⟧";

  /** English → the current language, or null when the string is unknown. */
  function lookup(s) {
    if (!dict) return null;
    const hit = dict.exact.get(s);
    if (hit !== undefined) return lang === PSEUDO ? pseudo(s) : hit;
    for (const t of dict.templates) {
      const m = t.re.exec(s);
      if (!m) continue;
      // A value filling a placeholder must be a number, a name, an id, or itself translatable; otherwise a short
      // template ("{0} for {1}") would turn untranslated English into a half-translated sentence.
      const caps = m.slice(1);
      const plain = (c) => c.split(/\s+/).filter((w) => /^[a-z]{3,}[.,;:]?$/.test(w)).length;
      if (!caps.every((c) => lookup(c.trim()) !== null || plain(c) < 2 || /^[\p{Lu}\d$#(−-]/u.test(c.trim()))) continue;
      if (lang === PSEUDO) return pseudo(s);
      return t.out.replace(/\{(\d)\}/g, (_, i) => {
        const v = m[t.order.indexOf(Number(i)) + 1] ?? "";
        return lookup(v.trim()) ?? v;
      });
    }
    return null;
  }
  function tr(s, quiet = false) {
    if (lang === "en") return s;
    const core = s.trim();
    if (!core || !/\p{L}/u.test(core)) return money(s);
    const lead = s.slice(0, s.indexOf(core[0]));
    const tail = s.slice(s.lastIndexOf(core[core.length - 1]) + 1);
    const flat = core.replace(/\s+/g, " ");
    const hit = lookup(flat);
    if (hit === null) {
      if (!quiet && /[a-z]{2,}/i.test(flat)) misses.add(flat);
      return money(s);
    }
    return lead + money(hit) + tail;
  }
  const skip = (n) => {
    const e = n.nodeType === 1 ? n : n.parentElement;
    return !e || !!e.closest(SKIP);
  };

  function setText(node, value) {
    if (node.nodeValue === value) return;
    mine.set(node, value);
    node.nodeValue = value;
  }
  /**
   * Adjacent text nodes are translated together: React splits "Closed {date}." or "Loading {what}…" into several
   * nodes. The whole run is tried first (quietly); if the dictionary doesn't know it, each node is translated alone.
   */
  function runOf(node) {
    const run = [node];
    for (let p = node.previousSibling; p && p.nodeType === 3; p = p.previousSibling) run.unshift(p);
    for (let n = node.nextSibling; n && n.nodeType === 3; n = n.nextSibling) run.push(n);
    return run;
  }
  function doRun(kids) {
    for (const k of kids) if (!orig.has(k)) orig.set(k, k.nodeValue);
    if (lang === "en") return kids.forEach((k) => setText(k, orig.get(k)));
    const whole = kids.map((k) => orig.get(k)).join("");
    const out = tr(whole, true);
    if (out !== whole && lookup(whole.trim().replace(/\s+/g, " ")) !== null) {
      setText(kids[0], out);
      kids.slice(1).forEach((k) => setText(k, ""));
    } else kids.forEach((k) => setText(k, tr(orig.get(k))));
  }
  function doText(node) {
    if (skip(node)) return;
    const run = runOf(node);
    if (run.length > 1) return doRun(run);
    if (!orig.has(node)) orig.set(node, node.nodeValue);
    const en = orig.get(node);
    setText(node, lang === "en" ? en : tr(en));
  }
  function doAttrs(e) {
    if (e.closest(SKIP)) return;
    let o = origAttr.get(e);
    for (const a of ATTRS) {
      if (!e.hasAttribute(a)) continue;
      const cur = e.getAttribute(a);
      const m = mineAttr.get(e);
      if (!o) origAttr.set(e, (o = {}));
      if (o[a] === undefined || (m?.[a] !== cur && o[a] !== cur)) o[a] = cur;
      const out = lang === "en" ? o[a] : tr(o[a]);
      if (out !== cur) {
        mineAttr.set(e, { ...(m || {}), [a]: out });
        e.setAttribute(a, out);
      }
    }
    if (e.tagName === "INPUT" && /^(submit|button)$/.test(e.type) && e.value) {
      if (!o) origAttr.set(e, (o = {}));
      o.value ??= e.value;
      const out = lang === "en" ? o.value : tr(o.value);
      if (out !== e.value) e.value = out;
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 || skip(root)) return;
    doAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const texts = [];
    let n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 1) doAttrs(n);
      else texts.push(n);
    }
    texts.forEach(doText);
    aiText(root);
  }

  // AI-written text: translated by the server (cached there), shown with a note; the original stays one tap away.
  let aiQueue = new Set();
  let aiTimer = null;
  function aiText(root) {
    if (lang === "en" || lang === PSEUDO) return;
    const els = root.nodeType === 1 ? [...(root.matches?.("[data-i18n-ai]") ? [root] : []), ...root.querySelectorAll("[data-i18n-ai]")] : [];
    for (const e of els) {
      const text = (e.getAttribute("data-i18n-ai-src") || e.textContent || "").trim();
      if (!text || aiDone.get(e) === lang + text) continue;
      if (!e.hasAttribute("data-i18n-ai-src")) e.setAttribute("data-i18n-ai-src", text);
      aiQueue.add(e);
    }
    clearTimeout(aiTimer);
    if (aiQueue.size) aiTimer = setTimeout(flushAi, 150);
  }
  async function flushAi() {
    const els = [...aiQueue].slice(0, 30);
    els.forEach((e) => aiQueue.delete(e));
    const want = lang;
    const texts = els.map((e) => e.getAttribute("data-i18n-ai-src"));
    try {
      const r = await fetch("/api/ui/translate", { method: "POST", headers: { "content-type": "application/json", "x-stocksure-ui": "1" }, body: JSON.stringify({ lang: want, texts }) });
      if (!r.ok) return;
      const j = await r.json();
      if (lang !== want) return;
      els.forEach((e, i) => {
        const out = j.texts?.[i];
        if (!out) return;
        aiDone.set(e, want + texts[i]);
        writeAi(e, out);
        e.setAttribute("title", `${t("Machine-translated. Original")}: ${texts[i]}`);
        e.setAttribute("lang", want);
      });
    } catch {
      /* offline: the English stays */
    }
    if (aiQueue.size) flushAi();
  }
  /** Writes into the element's own text node when it has one, so React keeps managing the same node. */
  function writeAi(e, text) {
    const kids = [...e.childNodes];
    if (kids.length === 1 && kids[0].nodeType === 3) setText(kids[0], text);
    else {
      observer.disconnect();
      e.textContent = text;
      observe();
    }
  }
  function restoreAi() {
    document.querySelectorAll("[data-i18n-ai-src]").forEach((e) => {
      writeAi(e, e.getAttribute("data-i18n-ai-src"));
      e.removeAttribute("title");
      e.removeAttribute("lang");
      aiDone.delete(e);
    });
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") {
        const n = r.target;
        if (mine.get(n) === n.nodeValue) continue;
        const ai = n.parentElement?.closest("[data-i18n-ai]");
        if (ai) {
          // New AI text from the app: remember it as the original and translate it again.
          ai.setAttribute("data-i18n-ai-src", ai.textContent.trim());
          aiDone.delete(ai);
          aiText(ai);
          continue;
        }
        orig.set(n, n.nodeValue);
        doText(n);
      } else if (r.type === "attributes") {
        const e = r.target;
        if (mineAttr.get(e)?.[r.attributeName] === e.getAttribute(r.attributeName)) continue;
        const o = origAttr.get(e);
        if (o) o[r.attributeName] = e.getAttribute(r.attributeName);
        doAttrs(e);
      } else r.addedNodes.forEach((n) => walk(n));
    }
  });
  const observe = () => observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  async function load(l) {
    if (l === "en") return null;
    const file = l === PSEUDO ? "en" : l;
    if (!cache[file]) {
      const r = await fetch(`/static/i18n/${file}.json?v=${V}`);
      if (!r.ok) throw new Error(`no dictionary for ${l}`);
      cache[file] = compile(await r.json());
    }
    return cache[file];
  }
  function font() {
    const root = document.documentElement;
    root.lang = lang === PSEUDO ? "en" : lang;
    root.dataset.lang = lang;
    if (lang === "hi-IN" && !document.getElementById("ss-deva")) {
      const l = document.createElement("link");
      l.id = "ss-deva";
      l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap";
      document.head.appendChild(l);
    }
  }
  function persist(l) {
    try { localStorage.setItem("ss-lang", l); } catch { /* private window */ }
    document.cookie = `ss-lang=${l}; path=/; max-age=31536000; SameSite=Lax`;
    fetch("/api/ui/lang", { method: "POST", headers: { "content-type": "application/json", "x-stocksure-ui": "1" }, body: JSON.stringify({ lang: l }) }).catch(() => undefined);
  }

  /** Switches language in place. */
  async function set(l, { save = true } = {}) {
    const next = norm(l) ?? "en";
    try {
      dict = await load(next);
    } catch {
      dict = null;
      return false;
    }
    lang = next;
    api.lang = next;
    api.locale = (LANGS[next] ?? LANGS.en).intl;
    font();
    if (save) persist(next);
    observer.disconnect();
    walk(document.documentElement);
    if (next === "en") restoreAi();
    observe();
    dispatchEvent(new CustomEvent("ssi18n:change", { detail: { lang: next } }));
    return true;
  }
  const t = (s) => (lang === "en" ? s : tr(s));
  /** The English text of an element (its accessible name or text), whatever language is on screen. */
  function original(e) {
    const a = origAttr.get(e)?.["aria-label"] ?? e.getAttribute("aria-label");
    if (a) return a;
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    let s = "", n;
    while ((n = w.nextNode())) s += orig.has(n) ? orig.get(n) : n.nodeValue;
    return s.replace(/\s+/g, " ").trim();
  }

  const api = {
    lang: "en",
    locale: "en-US",
    langs: Object.entries(LANGS).map(([code, v]) => ({ code, name: v.name })),
    set,
    t,
    original,
    misses,
    paypalLocale: () => (LANGS[lang] ?? LANGS.en).paypal,
    note: "Translations are machine-made. Payment and consent wording has not yet been checked by a person.",
  };
  window.ssI18n = api;
  const start = detect();
  api.from = start.from;
  const go = () => {
    observe();
    if (start.lang !== "en") set(start.lang, { save: start.from === "url" });
    else font();
  };
  if (document.documentElement) go();

  // The hands-free module (Look and Say) is an ES module; loading it from here keeps it out of the app's bundle.
  const me = document.currentScript?.src || "/static/i18n.js";
  const hf = document.createElement("script");
  hf.type = "module";
  hf.src = new URL("handsfree/lookandsay.js", me).href.replace(/\?.*$/, "") + (me.includes("?") ? me.slice(me.indexOf("?")) : "");
  document.head.appendChild(hf);
})();
