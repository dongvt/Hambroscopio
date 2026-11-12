import { GoogleAuth } from "google-auth-library";
import { AppError } from "../../lib/errors.js";

/**
 * Application Default Credentials. Locally this is gcloud's ADC file created with
 * `gcloud auth application-default login --impersonate-service-account=<SA>`;
 * on a VM it is the attached service account.
 */
export function createGoogleAuth(scopes: string[]): GoogleAuth {
  return new GoogleAuth({ scopes });
}

export interface GoogleErrorInfo {
  status: number | undefined;
  message: string;
}

/** Extracts status and message only. Raw gaxios errors carry request headers (tokens). */
export function googleErrorInfo(error: unknown): GoogleErrorInfo {
  const e = error as { status?: unknown; code?: unknown; response?: { status?: unknown } };
  const raw = e?.response?.status ?? e?.status ?? e?.code;
  const status =
    typeof raw === "number" ? raw : Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { status, message };
}

export function toGoogleAppError(service: string, operation: string, error: unknown): AppError {
  if (error instanceof AppError) return error;
  const { status, message } = googleErrorInfo(error);
  let hint = "";
  if (/default credentials/i.test(message)) {
    hint =
      " Run: gcloud auth application-default login --impersonate-service-account=<service account email>";
  } else if (status === 403) {
    hint = " Check that the resource is shared with the service account.";
  } else if (status === 404) {
    hint = " Check the ID in .env.";
  }
  const text = message.replace(/\.+\s*$/, "");
  return new AppError("external", `${service} ${operation} failed: ${text}.${hint}`, {
    details: { service, operation, status },
  });
}
