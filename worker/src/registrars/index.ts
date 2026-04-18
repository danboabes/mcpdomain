/**
 * Registrar factory. Picks the concrete implementation from env.REGISTRAR
 * (default: "opensrs"). Returns null when required secrets are missing, so
 * the webhook can gracefully leave orders in a "paid, awaiting_registration"
 * state instead of crashing the handler.
 */

import type { Registrar } from "./types";
import { OpenSRSRegistrar } from "./opensrs";

export type RegistrarEnv = {
  REGISTRAR?: string;
  OPENSRS_USERNAME?: string;
  OPENSRS_KEY?: string;
  OPENSRS_ENV?: string; // "live" | "ote"
};

export function makeRegistrar(env: RegistrarEnv): Registrar | null {
  const choice = (env.REGISTRAR || "opensrs").toLowerCase();
  if (choice === "opensrs") {
    if (!env.OPENSRS_USERNAME || !env.OPENSRS_KEY) return null;
    return new OpenSRSRegistrar({
      username: env.OPENSRS_USERNAME,
      key: env.OPENSRS_KEY,
      env: env.OPENSRS_ENV === "ote" ? "ote" : "live",
    });
  }
  return null;
}

export type { Registrar } from "./types";
