import busboy from "busboy";
import type { Request } from "express";
import { config } from "../config.js";
import { GtError } from "../lib/util.js";
import type { UploadFile } from "../services/orders.js";

/** Parses multipart/form-data (or urlencoded) into fields and files, with a size cap per file. */
export async function readForm(req: Request): Promise<{ fields: Record<string, string>; files: Record<string, UploadFile[]> }> {
  if (!req.is("multipart/form-data")) return { fields: (req.body ?? {}) as Record<string, string>, files: {} };
  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: Record<string, UploadFile[]> = {};
    const bb = busboy({ headers: req.headers, limits: { fileSize: config.maxUploadBytes, files: 10, fields: 200 } });
    let tooBig = false;
    bb.on("field", (name, val) => {
      fields[name] = val;
    });
    bb.on("file", (name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      stream.on("limit", () => {
        tooBig = true;
      });
      stream.on("end", () => {
        const body = Buffer.concat(chunks);
        if (!info.filename || !body.length) return;
        (files[name] ??= []).push({ filename: info.filename, mime: info.mimeType || "application/octet-stream", body });
      });
    });
    bb.on("error", reject);
    bb.on("close", () => (tooBig ? reject(new GtError(`A file is larger than ${Math.round(config.maxUploadBytes / 1048576)} MB.`, "too_large", 413)) : resolve({ fields, files })));
    req.pipe(bb);
  });
}
