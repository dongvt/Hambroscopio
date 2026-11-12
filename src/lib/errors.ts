export type ErrorCode =
  "config" | "validation" | "external" | "not_found" | "state" | "planning_failed";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options.details;
  }
}

const FUN_MESSAGES = [
  "Dude, encontré un error, dile a Govert que lo arregle",
  "Ay no, algo se quemó en la cocina. Govert, help!",
  "Houston, tenemos un problema. Llamen a Govert",
  "Se me cayó la olla. Govert, revisa los logs",
];

/** Channel-facing error text. The correlation ID links it to the logged stack. */
export function funErrorMessage(correlationId: string, random: () => number = Math.random): string {
  const index = Math.floor(random() * FUN_MESSAGES.length) % FUN_MESSAGES.length;
  return `⚠️ ${FUN_MESSAGES[index]} (id: ${correlationId})`;
}
