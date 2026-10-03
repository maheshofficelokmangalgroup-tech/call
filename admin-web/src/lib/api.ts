/** Browser-side API client. Every call goes through the server-side proxy (/api/backend), which holds the session. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly retryAfter?: number;

  constructor(status: number, code: string, message: string, details?: unknown, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

type Params = Record<string, string | number | boolean | null | undefined | (string | number)[]>;

export function buildQuery(params?: Params): string {
  if (!params) return "";
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => q.append(key, String(v)));
    else q.set(key, String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

let redirecting = false;

/** Send the browser to the sign-in page (a full page load, so nothing of the old session stays in memory) and bring it back afterwards. */
export function goToLogin() {
  if (typeof window === "undefined" || redirecting) return;
  redirecting = true;
  const next = `${window.location.pathname}${window.location.search}`;
  const target = new URL("/login", window.location.origin);
  if (next && next !== "/") target.searchParams.set("next", next);
  window.location.assign(target.href);
}

/** What to say when an answer carries no message of its own (the refusals of the front door - too large, restarting - are not JSON). */
export function plainStatus(status: number, forUpload = false): string {
  if (status === 413) return forUpload ? "That file is bigger than the server accepts. A sheet can be up to 200 MB - split it into two files." : "That is more than the server accepts in one request.";
  if (status === 502 || status === 503 || status === 504) return "The server is restarting or busy. Wait a minute and try again.";
  return `The server answered ${status}.`;
}

export async function parseError(res: Response): Promise<ApiError> {
  let code = "http_error";
  let message = plainStatus(res.status);
  let details: unknown;
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    } else if (Array.isArray(data?.detail)) {
      code = "validation_error";
      message = data.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(" ") || message;
    }
  } catch {
    /* not JSON */
  }
  const retry = Number(res.headers.get("retry-after"));
  return new ApiError(res.status, code, message, details, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Params;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
}

/** Call a backend endpoint: `api<Overview>("analytics/overview", { params: { date_from } })`. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { accept: "application/json", "x-requested-with": "admin-web" };
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(`/api/backend/${path.replace(/^\//, "")}${buildQuery(options.params)}`, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch (error) {
    if ((error as Error).name === "AbortError") throw error;
    throw new ApiError(0, "network_error", "Cannot reach the server. Check your internet connection.");
  }

  if (res.status === 401) {
    goToLogin();
    throw await parseError(res);
  }
  if (!res.ok) throw await parseError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface UploadOptions {
  form: FormData;
  /** called while the file travels: bytes sent so far, and the total */
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * POST a form with a big file and report how far it is. (`fetch` cannot say how much of a request body has been sent; a sheet of a
 * hundred megabytes takes a while, and a progress bar is the difference between "working" and "frozen".)
 */
export function upload<T>(path: string, { form, onProgress, signal }: UploadOptions): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/backend/${path.replace(/^\//, "")}`);
    request.setRequestHeader("accept", "application/json");
    request.setRequestHeader("x-requested-with", "admin-web");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    request.onerror = () => reject(new ApiError(0, "network_error", "Cannot reach the server. Check your internet connection."));
    request.ontimeout = () => reject(new ApiError(0, "network_error", "The upload took too long. Try again, or use a smaller file."));
    request.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    request.onload = () => {
      let data: { error?: { code?: string; message?: string; details?: unknown } } | undefined;
      try {
        data = JSON.parse(request.responseText) as typeof data;
      } catch {
        /* not JSON */
      }
      if (request.status === 401) {
        goToLogin();
        reject(new ApiError(401, data?.error?.code ?? "unauthenticated", data?.error?.message ?? "Please sign in."));
      } else if (request.status >= 200 && request.status < 300) {
        resolve(data as T);
      } else {
        const retry = Number(request.getResponseHeader("retry-after"));
        reject(new ApiError(request.status, data?.error?.code ?? "http_error", data?.error?.message ?? plainStatus(request.status, true), data?.error?.details, Number.isFinite(retry) && retry > 0 ? retry : undefined));
      }
    };
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(form);
  });
}

/** URL of a file download (CSV export, recording) served through the proxy - opened by the browser, which sends the cookies. */
export function downloadUrl(path: string, params?: Params): string {
  return `/api/backend/${path.replace(/^\//, "")}${buildQuery(params)}`;
}

/** A signed recording link from the backend, as the browser can open it: relative links go through the panel's proxy, S3 links are used as they are. */
export function mediaUrl(url: string): string {
  return url.startsWith("/api/v1/") ? `/api/backend/${url.slice("/api/v1/".length)}` : url;
}

/** Plain JSON post to one of the panel's own /api/auth routes. */
export async function authRequest<T>(path: "login" | "logout", body?: unknown): Promise<T> {
  const res = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "admin-web" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as T;
}

export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
