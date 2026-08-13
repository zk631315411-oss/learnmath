export enum ErrorType {
  NETWORK = 'NETWORK',
  TIMEOUT = 'TIMEOUT',
  AUTH = 'AUTH',
  VALIDATION = 'VALIDATION',
  SERVER = 'SERVER',
  UNKNOWN = 'UNKNOWN',
}

export class ApiError extends Error {
  type: ErrorType;
  status?: number;
  detail?: string;
  retryable: boolean;

  constructor(options: {
    message: string;
    type: ErrorType;
    status?: number;
    detail?: string;
    retryable?: boolean;
  }) {
    super(options.message);
    this.name = 'ApiError';
    this.type = options.type;
    this.status = options.status;
    this.detail = options.detail;
    this.retryable = options.retryable ?? (
      options.type === ErrorType.NETWORK ||
      options.type === ErrorType.TIMEOUT ||
      (options.type === ErrorType.SERVER && (options.status ?? 0) >= 500)
    );
  }
}

export function fromResponse(res: Response, body?: Record<string, any>): ApiError {
  const detail = body?.detail;
  let type: ErrorType;
  let message: string;

  if (res.status === 401 || res.status === 403) {
    type = ErrorType.AUTH;
    message = detail || '认证失败，请重新登录';
  } else if (res.status === 422) {
    type = ErrorType.VALIDATION;
    message = detail || '请求参数有误';
  } else if (res.status >= 500) {
    type = ErrorType.SERVER;
    message = detail || '服务器错误，请稍后重试';
  } else {
    type = ErrorType.UNKNOWN;
    message = detail || `请求失败 (${res.status})`;
  }

  return new ApiError({
    message,
    type,
    status: res.status,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail),
  });
}

export function fromNetworkError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  return new ApiError({
    message: err instanceof Error ? err.message : '网络连接失败',
    type: ErrorType.NETWORK,
  });
}

export function timeoutError(ms: number): ApiError {
  return new ApiError({
    message: `请求超时 (${ms / 1000}秒)`,
    type: ErrorType.TIMEOUT,
  });
}