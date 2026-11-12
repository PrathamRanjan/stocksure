/**
 * Collects the English the app shows, for translation: JSX text (with "{0}" where a value goes), string and
 * template literals in the React app, error messages, and the text of the server-rendered pages. Writes
 * public/i18n/en.json ({strings: {english: english}}). Strings seen at run time but missing here can be added
 * with --add (a JSON array file, e.g. from scripts/i18n-check.mts).
 *   npx tsx scripts/i18n-extract.mts [--add misses.json]
 */
import { createRequire } from "node:module";
const ts: typeof import("typescript") = createRequire(new URL("../web/package.json", import.meta.url))("typescript");
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const out = new Map<string, string>(); // key → first source
/** Product, company and people names from the demo seed: shown as they are, never translated (spec B2.3). */
const never = new Set<string>();
const add = (s: string, from: string) => {
  const k = s.replace(/\s+/g, " ").trim();
  if (!keep(k)) return;
  if (!out.has(k)) out.set(k, from);
};

const UTIL = /^(?:!?-?[a-z0-9]+(?:[-:/][\w.[\]%#()/,-]+)+|flex|grid|block|hidden|inline|sr-only|truncate|underline|uppercase|lowercase|italic|border|rounded|shadow|container|relative|absolute|fixed|sticky|grow|shrink|transition|outline-none|tabular-nums|font-mono|font-bold|font-semibold|font-medium|whitespace-nowrap|text-left|text-right|text-center)$/;
function keep(s: string): boolean {
  if (!s || s.length > 400 || !/\p{L}/u.test(s)) return false;
  if (/^(https?:|mailto:|\/|\.\/|#|data:|@\/|[\w-]+\.(?:ts|tsx|js|css|json|svg|png|csv|xlsx)$)/.test(s)) return false;
  if (/^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|WITH|DROP|BEGIN|COMMIT)\b/.test(s)) return false;
  if (/^[a-z][a-zA-Z0-9]*$/.test(s) || /^[A-Z0-9_]+$/.test(s) || /^[a-z0-9_.:-]+$/.test(s)) return false; // identifiers, constants, keys
  if (/^[a-z][\w-]*(?:\.[\w-]+)+$/.test(s)) return false;
  const toks = s.split(" ");
  if (toks.filter((t) => UTIL.test(t)).length / toks.length >= 0.5 && !/[A-Z.!?]/.test(s[0] + s[s.length - 1])) return false; // class lists
  if (/[{};]\s*$/.test(s) && /[:=]/.test(s)) return false; // css / code
  if (/^\W*$/.test(s.replace(/\{\d\}/g, ""))) return false;
  if (/^\{\d\}$/.test(s)) return false;
  if (/[<>]|="|^"|"$|^\\|attachment;|^(GET|POST|PUT|PATCH|DELETE) \//.test(s)) return false; // markup, headers, routes
  if (/^[A-Z]{2,6}-\d+$/.test(s) || (!s.includes(" ") && s.includes("/"))) return false; // SKUs, paths
  if (/^[\w-]+=/.test(s) || /^\{\d\}[\/:._-]/.test(s)) return false;
  return true;
}

const SKIP_ATTRS = new Set(["className", "class", "href", "to", "key", "id", "type", "variant", "size", "side", "align", "role", "name", "htmlFor", "src", "rel", "target", "method", "action", "autoComplete", "inputMode", "pattern", "data-tour", "value", "defaultValue", "accept", "form", "lang", "dir", "mode", "tone", "icon", "as", "kind", "data-state", "style"]);
const SKIP_CALLS = new Set(["cn", "clsx", "cva", "require", "import", "fetch", "api", "get", "post", "postJson", "query", "navigate", "nav", "setItem", "getItem", "removeItem", "querySelector", "querySelectorAll", "getElementById", "addEventListener", "removeEventListener", "startsWith", "endsWith", "includes", "split", "join", "replace", "test", "match", "localeCompare", "createElement", "setAttribute", "getAttribute", "hasAttribute", "dispatchEvent", "log", "warn", "error", "debug", "info", "setHeader", "header", "cookie", "clearCookie", "send", "redirect", "sendFile", "status", "Error"]);

function templateOf(n: ts.TemplateExpression): string {
  let s = n.head.text;
  n.templateSpans.forEach((sp, i) => (s += `{${i}}` + sp.literal.text));
  return s;
}
function jsxTemplate(children: readonly ts.JsxChild[]): string | null {
  // Only when every child is text or a plain expression: <p>Closed {when(x)}.</p> → "Closed {0}."
  if (!children.some((c) => ts.isJsxText(c) && /\p{L}/u.test(c.text))) return null;
  if (!children.some((c) => ts.isJsxExpression(c) && c.expression)) return null;
  let s = "", i = 0;
  for (const c of children) {
    if (ts.isJsxText(c)) s += c.text;
    else if (ts.isJsxExpression(c)) {
      if (!c.expression) continue;
      if (ts.isStringLiteral(c.expression)) s += c.expression.text;
      else s += `{${i++}}`;
    } else return null;
  }
  return i > 0 && i < 10 ? s : null;
}

function scan(file: string, server: boolean) {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = file.slice(root.length);
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isJsxAttribute(n)) {
      const name = n.name.getText();
      if (SKIP_ATTRS.has(name) || (name.startsWith("data-") && name !== "data-ls-name") || (name.startsWith("aria-") && !/aria-(label|description|valuetext)/.test(name))) return;
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^(product|supplier|buyer|org|person|addProduct)$/.test(n.expression.text)) {
      // product(sku, name, …): only the name; units such as "case" are interface words and are translated.
      const a = n.expression.text === "product" ? n.arguments[1] : n.arguments.find((x) => ts.isStringLiteral(x));
      if (a && ts.isStringLiteral(a)) never.add(a.text.replace(/\s+/g, " ").trim());
    }
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const nm = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "";
      if (SKIP_CALLS.has(nm) && !(server && nm === "Error")) {
        if (nm === "log" || nm === "warn" || nm === "error" || nm === "info" || nm === "debug" || nm === "cn" || nm === "clsx" || nm === "cva" || nm === "query") return;
      }
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && /^(className|class|href|to|id|key|path|url|icon|sku|code|kind|tone|status|type|variant|method)$/.test(n.name.text)) return;
    if (ts.isTaggedTemplateExpression(n) && /(^|\.)(html|sql)$/.test(n.tag.getText())) {
      if (n.tag.getText().endsWith("sql")) return;
      const lits = ts.isNoSubstitutionTemplateLiteral(n.template) ? [n.template.text] : [n.template.head.text, ...n.template.templateSpans.map((s) => s.literal.text)];
      for (const l of lits) for (const piece of l.split(/<[^>]*>|&[a-z]+;/)) add(piece, rel);
      ts.forEachChild(n, visit);
      return;
    }
    if (ts.isJsxText(n)) add(n.text, rel);
    else if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const t = jsxTemplate(n.children);
      if (t) add(t, rel);
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      if (!ts.isPropertyAssignment(n.parent) || n.parent.initializer === n) add(n.text, rel);
    } else if (ts.isTemplateExpression(n)) add(templateOf(n), rel);
    ts.forEachChild(n, visit);
  };
  visit(src);
}

function files(dir: string, re: RegExp): string[] {
  const outF: string[] = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      if (!/node_modules|ui$/.test(f)) outF.push(...files(p, re));
    } else if (re.test(f) && !/\.test\.|\.spec\./.test(f)) outF.push(p);
  }
  return outF;
}

for (const f of files(join(root, "web/src"), /\.(tsx|ts)$/)) scan(f, false);
for (const d of ["src/web", "src/lib", "src/services", "src/core", "src/demo", "src/guard", "src/safety", "src/channels"]) if (existsSync(join(root, d))) for (const f of files(join(root, d), /\.ts$/)) scan(f, true);
const i = process.argv.indexOf("--add");
const forced = new Set<string>();
if (i > 0) for (const s of JSON.parse(readFileSync(process.argv[i + 1], "utf8")) as string[]) forced.add(s.replace(/\s+/g, " ").trim());

// Static English in the shared scripts (hands-free bar, language layer).
for (const f of ["public/handsfree/lookandsay.js", "public/i18n.js", "public/a11y.js"]) scan(join(root, f), false);

// The page title and description in the app's HTML shell.
const shell = readFileSync(join(root, "web/index.html"), "utf8");
for (const m of shell.matchAll(/<title>([^<]+)<\/title>|name="description" content="([^"]+)"/g)) add((m[1] ?? m[2]).replace(/&amp;/g, "&"), "web/index.html");
for (const k of never) out.delete(k);

const prev = existsSync(join(root, "public/i18n/en.json")) ? JSON.parse(readFileSync(join(root, "public/i18n/en.json"), "utf8")).strings : {};
const strings: Record<string, string> = Object.fromEntries(Object.entries(prev as Record<string, string>).filter(([k]) => !never.has(k)));
for (const k of [...out.keys(), ...forced].sort()) strings[k] = k;
writeFileSync(join(root, "public/i18n/en.json"), JSON.stringify({ v: 1, lang: "en", strings }, null, 1) + "\n");
console.log(`${Object.keys(strings).length} strings (${out.size} found now)`);
