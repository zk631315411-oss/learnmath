import { ApiError, ErrorType, fromNetworkError, fromResponse, timeoutError } from './error';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const DEFAULT_TIMEOUT = 30_000;

const MAX_RETRIES = 3;

const RETRY_BASE_DELAY = 1000;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  url: string;
  body?: unknown;
  token?: string;
  timeout?: number;
  maxRetries?: number;
  /** 请求开始时的回调，用于调用方管理 loading 状态 */
  onLoadingStart?: () => void;
  /** 请求结束时的回调（无论成功或失败），用于调用方管理 loading 状态 */
  onLoadingEnd?: () => void;
  rawResponse?: boolean;
}

type RequestInterceptor = (config: RequestOptions) => RequestOptions;

type ResponseInterceptor = (response: Response, config: RequestOptions) => Response | Promise<Response>;

type ErrorInterceptor = (error: ApiError, config: RequestOptions) => ApiError | Promise<ApiError>;

const interceptors = {
  request: [] as RequestInterceptor[],
  response: [] as ResponseInterceptor[],
  error: [] as ErrorInterceptor[],
};

export function addInterceptor(
  type: 'request',
  fn: RequestInterceptor,
): () => void;
export function addInterceptor(
  type: 'response',
  fn: ResponseInterceptor,
): () => void;
export function addInterceptor(
  type: 'error',
  fn: ErrorInterceptor,
): () => void;
export function addInterceptor(
  type: 'request' | 'response' | 'error',
  fn: RequestInterceptor | ResponseInterceptor | ErrorInterceptor,
): () => void {
  const list = interceptors[type];
  list.push(fn as never);
  return () => {
    const idx = list.indexOf(fn as never);
    if (idx !== -1) list.splice(idx, 1);
  };
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildFetchConfig(config: RequestOptions): RequestInit {
  const headers: Record<string, string> = {};
  const isFormData = config.body instanceof FormData;

  if (config.body !== undefined && config.body !== null && !isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (config.token) {
    headers['Authorization'] = `Bearer ${config.token}`;
  }

  if (config.headers) {
    if (config.headers instanceof Headers) {
      config.headers.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(config.headers)) {
      config.headers.forEach(([k, v]) => { headers[k] = v; });
    } else {
      Object.assign(headers, config.headers);
    }
  }

  return {
    method: config.method || 'GET',
    headers,
    body: config.body !== undefined
      ? (isFormData ? config.body as FormData : JSON.stringify(config.body))
      : undefined,
    signal: config.signal,
  };
}

export async function request<T = unknown>(config: RequestOptions): Promise<T> {
  const {
    url,
    token,
    timeout = DEFAULT_TIMEOUT,
    maxRetries = MAX_RETRIES,
    onLoadingStart,
    onLoadingEnd,
    rawResponse = false,
    ...restConfig
  } = config;

  let finalConfig: RequestOptions = { url, token, timeout, maxRetries, onLoadingStart, onLoadingEnd, rawResponse, ...restConfig };
  for (const fn of interceptors.request) {
    finalConfig = fn(finalConfig);
  }

  // 通过回调通知调用方 loading 状态变化，避免在普通函数中调用 React Hook
  onLoadingStart?.();

  let lastError: ApiError | null = null;
  const fullUrl = `${API_BASE}${url}`;
  const fetchConfig = buildFetchConfig(finalConfig);

  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await delay(RETRY_BASE_DELAY * Math.pow(2, attempt - 1));
      }

      try {
        const controller = new AbortController();
        const abortFromCaller = () => controller.abort();
        if (finalConfig.signal?.aborted) controller.abort();
        else finalConfig.signal?.addEventListener('abort', abortFromCaller, { once: true });
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        let res: Response;
        try {
          res = await fetch(fullUrl, {
            ...fetchConfig,
            signal: controller.signal,
          });
        } catch (fetchErr) {
          if (controller.signal.aborted) {
            if (finalConfig.signal?.aborted) throw fromNetworkError(new Error('请求已取消'));
            throw timeoutError(timeout);
          }
          throw fromNetworkError(fetchErr);
        } finally {
          clearTimeout(timeoutId);
          finalConfig.signal?.removeEventListener('abort', abortFromCaller);
        }

        if (rawResponse) {
          // rawResponse 模式仍需检查 HTTP 状态码，SSE 流在 5xx 时不应静默通过
          if (!res.ok) {
            let body: Record<string, any> | undefined;
            try {
              body = await res.json();
            } catch {
              // 响应体非 JSON 时忽略
            }
            const apiErr = fromResponse(res, body);

            if (apiErr.retryable && attempt < maxRetries) {
              lastError = apiErr;
              continue;
            }
            throw apiErr;
          }
          return res as unknown as T;
        }

        for (const fn of interceptors.response) {
          res = await fn(res, finalConfig);
        }

        if (!res.ok) {
          let body: Record<string, any> | undefined;
          try {
            body = await res.json();
          } catch {
            // 响应体非 JSON 时忽略
          }
          const apiErr = fromResponse(res, body);

          if (apiErr.retryable && attempt < maxRetries) {
            lastError = apiErr;
            continue;
          }
          throw apiErr;
        }

        if (res.status === 204) {
          return undefined as unknown as T;
        }

        return await res.json() as T;
      } catch (err) {
        if (err instanceof ApiError && err.retryable && attempt < maxRetries) {
          lastError = err;
          continue;
        }
        let finalErr = err instanceof ApiError ? err : fromNetworkError(err);
        for (const fn of interceptors.error) {
          finalErr = await fn(finalErr, finalConfig);
        }
        throw finalErr;
      }
    }

    throw lastError || new ApiError({ message: '请求失败', type: ErrorType.UNKNOWN });
  } finally {
    onLoadingEnd?.();
  }
}

export async function get<T = unknown>(url: string, token?: string, options?: Partial<RequestOptions>): Promise<T> {
  return request<T>({ url, method: 'GET', token, ...options });
}

export async function post<T = unknown>(url: string, body?: unknown, token?: string, options?: Partial<RequestOptions>): Promise<T> {
  return request<T>({ url, method: 'POST', body, token, ...options });
}

export async function put<T = unknown>(url: string, body?: unknown, token?: string, options?: Partial<RequestOptions>): Promise<T> {
  return request<T>({ url, method: 'PUT', body, token, ...options });
}

export async function patch<T = unknown>(url: string, body?: unknown, token?: string, options?: Partial<RequestOptions>): Promise<T> {
  return request<T>({ url, method: 'PATCH', body, token, ...options });
}

export async function del<T = unknown>(url: string, token?: string, options?: Partial<RequestOptions>): Promise<T> {
  return request<T>({ url, method: 'DELETE', token, ...options });
}

export { API_BASE };
