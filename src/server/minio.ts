import { Client } from "minio";

/**
 * MinIO object storage (SPEC §4).
 *
 * All user uploads and generated images live in the single "fifi" bucket.
 * `MINIO_ENDPOINT` may include a scheme — `https://minioapi.gohire.top` parses
 * to endPoint `minioapi.gohire.top`, useSSL true, port 443. An explicit
 * `:port` is always respected. `MINIO_SECURE` is only consulted when the
 * endpoint carries no scheme.
 *
 * TEST_MODE=mock swaps the whole thing for an in-memory Map behind the same
 * exports (presigned urls become `fake://<key>`), so tests never need a
 * running MinIO.
 */

export const BUCKET = "fifi";

const PRESIGN_EXPIRY_SECONDS = 3600;

function isMock(): boolean {
  return process.env.TEST_MODE === "mock";
}

interface ParsedEndpoint {
  endPoint: string;
  port: number;
  useSSL: boolean;
}

function parseEndpoint(raw: string): ParsedEndpoint {
  let rest = raw.trim();
  let scheme: "http" | "https" | null = null;

  const schemeMatch = /^(https?):\/\//i.exec(rest);
  if (schemeMatch) {
    scheme = schemeMatch[1].toLowerCase() as "http" | "https";
    rest = rest.slice(schemeMatch[0].length);
  }
  // Drop any path suffix (e.g. trailing slash).
  rest = rest.replace(/\/.*$/, "");

  let host = rest;
  let explicitPort: number | null = null;
  const colon = rest.lastIndexOf(":");
  if (colon !== -1 && /^\d+$/.test(rest.slice(colon + 1))) {
    host = rest.slice(0, colon);
    explicitPort = Number(rest.slice(colon + 1));
  }
  if (!host) {
    throw new Error(`MINIO_ENDPOINT is malformed: "${raw}"`);
  }

  // MINIO_SECURE only matters when the endpoint has no scheme.
  const useSSL =
    scheme !== null
      ? scheme === "https"
      : /^(1|true|yes)$/i.test(process.env.MINIO_SECURE ?? "");
  const port = explicitPort ?? (useSSL ? 443 : 80);

  return { endPoint: host, port, useSSL };
}

let client: Client | null = null;

function getClient(): Client {
  if (client) return client;
  const endpoint = process.env.MINIO_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      "MINIO_ENDPOINT is not configured — object storage is unavailable",
    );
  }
  const { endPoint, port, useSSL } = parseEndpoint(endpoint);
  client = new Client({
    endPoint,
    port,
    useSSL,
    accessKey: process.env.MINIO_ACCESS_KEY ?? "",
    secretKey: process.env.MINIO_SECRET_KEY ?? "",
  });
  return client;
}

// ===== TEST_MODE=mock in-memory fake =====

const mockStore = new Map<string, { buf: Buffer; mime: string }>();

// ===== Public API =====

let bucketEnsured = false;

export async function ensureBucket(): Promise<void> {
  if (isMock()) return;
  if (bucketEnsured) return;
  const c = getClient();
  try {
    const exists = await c.bucketExists(BUCKET);
    if (!exists) await c.makeBucket(BUCKET);
    bucketEnsured = true;
  } catch (err) {
    // Race-safe: a concurrent caller/process may have created the bucket
    // between our existence check and makeBucket. Re-check before failing.
    const exists = await c.bucketExists(BUCKET).catch(() => false);
    if (!exists) throw err;
    bucketEnsured = true;
  }
}

export async function putObject(
  key: string,
  buf: Buffer,
  mime: string,
): Promise<void> {
  if (isMock()) {
    mockStore.set(key, { buf, mime });
    return;
  }
  await ensureBucket();
  await getClient().putObject(BUCKET, key, buf, buf.length, {
    "Content-Type": mime,
  });
}

export async function presignedGetUrl(
  key: string,
  expirySeconds: number = PRESIGN_EXPIRY_SECONDS,
): Promise<string> {
  if (isMock()) return `fake://${key}`;
  return getClient().presignedGetObject(BUCKET, key, expirySeconds);
}

/**
 * Reads a stored object back into memory (used by multimodal extraction).
 * Honors the in-memory fake under TEST_MODE=mock.
 */
export async function getObjectBuffer(key: string): Promise<Buffer> {
  if (isMock()) {
    const hit = mockStore.get(key);
    if (!hit) throw new Error(`mock minio: object not found: ${key}`);
    return hit.buf;
  }
  const stream = await getClient().getObject(BUCKET, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
