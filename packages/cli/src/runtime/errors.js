export const EXIT_CODES = {
  ok: 0,
  usage: 2,
  auth: 3,
  network: 4,
  conflict: 5,
  backend: 6,
  unexpected: 7,
  payment: 8,
};

export class CliError extends Error {
  constructor({
    code,
    message,
    exitCode = EXIT_CODES.unexpected,
    retryable = false,
    details = {},
    hints = [],
    warnings = [],
    cause,
  }) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.exitCode = exitCode;
    this.retryable = retryable;
    this.details = details;
    this.hints = hints;
    this.warnings = warnings;
    this.cause = cause;
  }
}

export function asCliError(error) {
  if (error instanceof CliError) {
    return error;
  }

  return new CliError({
    code: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error),
    exitCode: EXIT_CODES.unexpected,
    cause: error,
  });
}

export function usageError(message, details = {}) {
  return new CliError({
    code: 'usage_error',
    message,
    details,
    exitCode: EXIT_CODES.usage,
  });
}

