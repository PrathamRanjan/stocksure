import { useRouter, usePathname } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useState } from "react";
import { Platform } from "react-native";
import { useToast } from "@/components/toast";
import { api, serverUrl } from "./api";
import { resolve, type ActResult, type Fields } from "./client";
import * as haptics from "./haptics";
import { appTarget } from "./routes";
import { useSession } from "./session";

/** Open a server page the app has no screen for (PayPal approval, passkey page) in the in-app browser. */
export async function openWeb(path: string) {
  const url = resolve(serverUrl(), path);
  if (Platform.OS === "web") {
    window.location.href = url;
    return;
  }
  await WebBrowser.openBrowserAsync(url, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
}

/**
 * Runs a POST against the server's own handlers and does what its redirect would have done:
 * the server's message as a toast, a haptic, then reload the screen or move to the screen it named.
 */
export function useAction(reload?: () => void) {
  const router = useRouter();
  const here = usePathname();
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async (key: string, path: string, data: Fields | FormData = {}, opts: { stay?: boolean; quiet?: boolean } = {}): Promise<ActResult> => {
      setBusy(key);
      const r = await api.act(path, data);
      setBusy(null);
      if (r.external && r.to) {
        await openWeb(r.to);
        reload?.();
        void refresh();
        return r;
      }
      if (r.auth) {
        haptics.warn();
        toast.error(r.message || "Sign in first.");
        router.replace("/sign-in");
        return r;
      }
      if (r.ok) haptics.success();
      else haptics.warn();
      if (r.message && !(opts.quiet && r.ok)) (r.ok ? toast.success : toast.error)(r.message);
      void refresh();
      const t = appTarget(r.to?.split("#")[0]);
      if (!opts.stay && t.kind === "screen" && t.href !== here) router.push(t.href as never);
      else reload?.();
      return r;
    },
    [router, here, toast, refresh, reload],
  );
  return { run, busy };
}
