import { createHash, randomBytes } from "node:crypto";

export class GtError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400, readonly data?: unknown) {
    super(message);
  }
}

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const dollars = (cents: number) => (cents / 100).toFixed(2);
export const fmtUsd = (cents: number | null | undefined) => (cents === null || cents === undefined ? "—" : `$${dollars(cents)}`);

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

export function hashKey(key: string): string {
  return sha256Hex("ss-key:" + key);
}

export function minutesFromNow(m: number, now = Date.now()) {
  return new Date(now + m * 60_000);
}

export function asDate(v: Date | string | null | undefined): Date | null {
  return v ? new Date(v) : null;
}
