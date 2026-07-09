export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, details?: unknown, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? codeFromStatus(statusCode);
    this.details = details;
  }
}

const codeFromStatus = (statusCode: number) => {
  switch (statusCode) {
    case 400: return 'VALIDATION_ERROR';
    case 401: return 'UNAUTHORIZED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    default: return 'INTERNAL_ERROR';
  }
};

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details, 'VALIDATION_ERROR');
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message, undefined, 'UNAUTHORIZED');
export const forbidden = (message = 'Forbidden') => new HttpError(403, message, undefined, 'FORBIDDEN');
export const notFound = (message: string) => new HttpError(404, message, undefined, 'NOT_FOUND');
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, details, 'CONFLICT');
