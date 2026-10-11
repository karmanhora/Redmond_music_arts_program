/**
 * Profile pictures.
 *
 * The `avatars` bucket is **private** (migration 030): there is no anonymous URL
 * for a student's face, and reading a picture is subject to the same membership
 * rules as reading their profile row. So this module does two jobs:
 *
 *   1. **Preparing an upload** — validate the file for real (size, declared
 *      type, magic bytes, and whether it actually decodes), then center-crop it
 *      to a square and re-encode it small. A 4 MB phone photo becomes ~40 KB.
 *   2. **Resolving a display URL** — batch-sign object paths for an hour and
 *      cache them until shortly before they lapse. Nothing stores a signed URL:
 *      `profiles.avatar_path` holds the object path, so a rotated link never
 *      needs a database write.
 *
 * Object paths are `<auth_user_id>/<uuid>.webp`. The owner folder is the
 * Supabase Auth user id — opaque, stable, and free of any name or email, which
 * is what the storage policies key on.
 */
import { supabase } from "./supabase";

export const AVATAR_BUCKET = "avatars";

/** 5 MB — matches the bucket's own `file_size_limit`. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export const AVATAR_ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** The stored square is this many pixels a side — crisp on a phone, still tiny. */
const AVATAR_PIXELS = 512;

/** How long a display URL stays valid, and when we refresh before it expires. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export const AVATAR_ACCEPT_ATTR = "image/jpeg,image/png,image/webp";

export interface PreparedAvatar {
  /** The cropped, compressed square, ready to upload. */
  blob: Blob;
  /** An object URL for the on-screen preview — the caller must revoke it. */
  previewUrl: string;
  width: number;
  height: number;
}

/** Human-readable reason a file was refused, or null when it is acceptable. */
export function avatarFileError(file: File): string | null {
  if (file.size === 0) return "That file is empty — pick a different picture.";
  if (file.size > AVATAR_MAX_BYTES) {
    return `That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`;
  }
  // The browser's `type` is a hint, not a fact, so it is only the first filter.
  if (file.type && !(AVATAR_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return "Use a JPEG, PNG or WebP picture.";
  }
  return null;
}

/** Sniff the real container from the first bytes, ignoring the filename. */
export async function sniffImageType(file: File): Promise<"jpeg" | "png" | "webp" | null> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (head.length < 12) return null;
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47 &&
    head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a
  ) {
    return "png";
  }
  // "RIFF????WEBP"
  const riff =
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  if (riff) return "webp";
  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Validate and normalize a chosen file: the bytes must really be an image the
 * browser can decode (so a renamed `.exe` is refused), the result is center-
 * cropped to a square and re-encoded small. The original aspect ratio is kept
 * for the *preview* the caller shows — this is only what gets stored.
 */
export async function prepareAvatar(file: File): Promise<{ prepared: PreparedAvatar } | { error: string }> {
  const basic = avatarFileError(file);
  if (basic) return { error: basic };

  const sniffed = await sniffImageType(file);
  if (!sniffed) return { error: "That file isn't a JPEG, PNG or WebP picture." };

  let bitmap: ImageBitmap;
  try {
    // `from-image` honours the EXIF rotation a phone camera writes, so a
    // portrait photo is not stored sideways.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      return { error: "That picture couldn't be read — it may be damaged." };
    }
  }

  if (bitmap.width < 32 || bitmap.height < 32) {
    bitmap.close();
    return { error: "That picture is too small — use one at least 64×64." };
  }

  const side = Math.min(bitmap.width, bitmap.height);
  const sx = Math.floor((bitmap.width - side) / 2);
  const sy = Math.floor((bitmap.height - side) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_PIXELS;
  canvas.height = AVATAR_PIXELS;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return { error: "This browser can't prepare pictures for upload." };
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_PIXELS, AVATAR_PIXELS);
  bitmap.close();

  const blob = (await canvasToBlob(canvas, "image/webp", 0.85)) ?? (await canvasToBlob(canvas, "image/jpeg", 0.88));
  if (!blob) return { error: "That picture couldn't be prepared for upload." };

  return {
    prepared: {
      blob,
      previewUrl: URL.createObjectURL(blob),
      width: AVATAR_PIXELS,
      height: AVATAR_PIXELS,
    },
  };
}

/** `<auth uid>/<uuid>.webp` — no name, no email, one picture per upload. */
export function newAvatarPath(authUserId: string): string {
  const ext = "webp";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${authUserId}/${id}.${ext}`;
}

export async function uploadAvatar(
  authUserId: string,
  prepared: PreparedAvatar
): Promise<{ path: string } | { error: string }> {
  const path = newAvatarPath(authUserId);
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, prepared.blob, {
    contentType: prepared.blob.type || "image/webp",
    cacheControl: "3600",
    upsert: false,
  });
  if (error) {
    return { error: `Couldn't upload that picture: ${error.message}` };
  }
  return { path };
}

/**
 * Remove an object we no longer need (a replaced or cleared picture). A failure
 * is not fatal — the row no longer points at it, and the owner is the only
 * person who can read it — so callers log rather than block.
 */
export async function deleteAvatarObject(path: string): Promise<string | null> {
  if (!path) return null;
  const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
  return error ? error.message : null;
}

/* -------------------------------------------------------------------------- */
/* Signed display URLs                                                        */
/* -------------------------------------------------------------------------- */

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const urlCache = new Map<string, CacheEntry>();

/** A cached URL for a path, if it is still comfortably valid. */
export function cachedAvatarUrl(path: string): string | null {
  const hit = urlCache.get(path);
  if (!hit) return null;
  if (hit.expiresAt - REFRESH_MARGIN_MS <= Date.now()) {
    urlCache.delete(path);
    return null;
  }
  return hit.url;
}

/**
 * Sign a batch of paths — one request for the whole screen, so a 40-person
 * roster is one round-trip. Paths the caller may not read come back as errors
 * and are simply left uncached (the avatar falls back to initials).
 */
export async function signAvatarPaths(paths: string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))].filter((p) => !cachedAvatarUrl(p));
  if (wanted.length === 0) {
    const done: Record<string, string> = {};
    for (const p of paths) {
      const cached = cachedAvatarUrl(p);
      if (cached) done[p] = cached;
    }
    return done;
  }

  const { data, error } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrls(wanted, SIGNED_URL_TTL_SECONDS);

  const resolved: Record<string, string> = {};
  const expiresAt = Date.now() + SIGNED_URL_TTL_SECONDS * 1000;

  if (!error && data) {
    for (const item of data) {
      if (item.signedUrl && item.path) {
        // Supabase returns the path relative to the bucket.
        const key = wanted.find((p) => p === item.path) ?? item.path;
        urlCache.set(key, { url: item.signedUrl, expiresAt });
        resolved[key] = item.signedUrl;
      }
    }
  }

  // Whatever the server had cached stays usable even if this call failed.
  for (const p of paths) {
    const cached = cachedAvatarUrl(p);
    if (cached) resolved[p] = cached;
  }
  return resolved;
}

/** Drop a cache entry (after a replace or a remove) so the next read re-signs. */
export function forgetAvatarUrl(path: string): void {
  if (path) urlCache.delete(path);
}
