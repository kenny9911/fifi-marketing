"use client";

import type { FileDto } from "@/lib/api-types";

/**
 * Thin same-origin fetch wrapper for the FiFi API routes (SPEC §5).
 *
 * - Sends/receives JSON; server errors `{ error: string }` become
 *   `ApiClientError` with the HTTP status attached.
 * - Any 401 outside `/api/auth/*` means the session cookie died — the user is
 *   bounced to `/login?next=<current path>` so they land back where they were.
 * - `upload()` posts multipart form data to `/api/files` (req 7).
 */

export class ApiClientError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
  }
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = window.location.pathname + window.location.search;
  window.location.href = `/login?next=${encodeURIComponent(next)}`;
}

/** Parse a response body as JSON, tolerating empty bodies (202/204). */
async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

async function handle<T>(url: string, res: Response): Promise<T> {
  if (res.ok) {
    return (await parseJson(res)) as T;
  }
  const body = (await parseJson(res)) as { error?: unknown } | null;
  const message =
    body && typeof body.error === "string" && body.error
      ? body.error
      : `请求失败（HTTP ${res.status}）`;
  if (res.status === 401 && !url.startsWith("/api/auth/")) {
    redirectToLogin();
  }
  throw new ApiClientError(res.status, message);
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: "same-origin",
      headers:
        body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(0, "网络异常，请检查网络连接后重试");
  }
  return handle<T>(url, res);
}

export const api = {
  get<T>(url: string): Promise<T> {
    return request<T>("GET", url);
  },

  post<T>(url: string, body?: unknown): Promise<T> {
    return request<T>("POST", url, body);
  },

  put<T>(url: string, body?: unknown): Promise<T> {
    return request<T>("PUT", url, body);
  },

  del<T>(url: string): Promise<T> {
    return request<T>("DELETE", url);
  },

  /** Multipart upload to /api/files; the server auto-extracts text when needed. */
  async upload(file: File, taskId?: string): Promise<FileDto> {
    const form = new FormData();
    form.append("file", file);
    if (taskId) form.append("taskId", taskId);
    let res: Response;
    try {
      res = await fetch("/api/files", {
        method: "POST",
        credentials: "same-origin",
        body: form,
      });
    } catch {
      throw new ApiClientError(0, "网络异常，文件上传失败，请重试");
    }
    return handle<FileDto>("/api/files", res);
  },
};
