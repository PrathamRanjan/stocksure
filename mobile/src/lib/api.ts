import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { ApiError, createClient } from "./client";

/**
 * Which StockSure server the app talks to. On native it defaults to the live sandbox demo (override with
 * EXPO_PUBLIC_STOCKSURE_URL or from the Account tab). On web the preview server proxies the API on the same
 * origin, so the base is empty.
 */
export const LIVE_URL = "https://pph-stocksure.onrender.com";
const DEFAULT = Platform.OS === "web" ? "" : (process.env.EXPO_PUBLIC_STOCKSURE_URL ?? LIVE_URL);
const KEY = "stocksure.server";
let base = DEFAULT;
const listeners = new Set<() => void>();

export const serverUrl = () => base;
export const serverLabel = () => (base === "" ? "this preview's server" : base.replace(/^https?:\/\//, ""));

export async function loadServer() {
  if (Platform.OS === "web") return;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) base = v;
  } catch {
    /* keep the default */
  }
}

export async function setServer(url: string) {
  base = url.replace(/\/+$/, "");
  try {
    await AsyncStorage.setItem(KEY, base);
  } catch {
    /* still used for this run */
  }
  listeners.forEach((l) => l());
}

export function onServerChange(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export const api = createClient({ base: serverUrl });
export { ApiError };

/** Load a view model; reload on demand (quietly for pull-to-refresh); poll while `poll` is set; refresh on foreground. */
export function useView<T>(path: string | null, opts: { poll?: number | false } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const load = useCallback(
    async (mode: "full" | "quiet" | "pull" = "full") => {
      if (!path) return;
      const n = ++seq.current;
      if (mode === "full") setLoading(true);
      if (mode === "pull") setRefreshing(true);
      try {
        const d = await api.get<T>(path);
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof ApiError ? e : new ApiError(String(e), 0));
      } finally {
        if (n === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [path],
  );

  useEffect(() => {
    setData(null);
    void load();
    return onServerChange(() => void load());
  }, [load]);

  useEffect(() => {
    if (!opts.poll) return;
    const t = setInterval(() => {
      if (AppState.currentState === "active") void load("quiet");
    }, opts.poll);
    return () => clearInterval(t);
  }, [opts.poll, load]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && void load("quiet"));
    return () => sub.remove();
  }, [load]);

  return { data, error, loading: loading && !data, refreshing, reload: load, setData };
}
