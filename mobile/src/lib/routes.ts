/**
 * Map a path the server answers with (`to` in an action result) onto a screen in this app.
 * Paths the app has no screen for open on the web, in the system browser.
 */
export type AppTarget = { kind: "screen"; href: string } | { kind: "web"; path: string } | { kind: "stay" };

export function appTarget(to: string | undefined | null): AppTarget {
  if (!to) return { kind: "stay" };
  if (/^https?:\/\//i.test(to)) return { kind: "web", path: to };
  const [path] = to.split(/[?#]/);
  let m: RegExpMatchArray | null;
  if ((m = path.match(/^\/po\/([^/]+)\/receive$/))) return { kind: "screen", href: `/order/${m[1]}/receive` };
  if ((m = path.match(/^\/po\/([^/]+)$/)) && m[1] !== "new") return { kind: "screen", href: `/order/${m[1]}` };
  if (path === "/home" || path === "/") return { kind: "screen", href: "/" };
  if (path === "/approvals") return { kind: "screen", href: "/approvals" };
  if (path === "/login") return { kind: "screen", href: "/sign-in" };
  return { kind: "web", path: to };
}
