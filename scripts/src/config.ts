import fs from "node:fs";
import path from "node:path";
import { FlowConfig } from "./types.js";

export interface ParsedArgs {
  command: string;
  options: Record<string, string>;
  flags: Set<string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const [command = ""] = argv;
  const options: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];

    if (!next || next.startsWith("--")) {
      flags.add(key);
      continue;
    }

    options[key] = next;
    i++;
  }

  return { command, options, flags };
}

export function requireOption(parsed: ParsedArgs, key: string): string {
  const value = parsed.options[key];
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

export function getBoolOption(parsed: ParsedArgs, key: string, defaultValue: boolean): boolean {
  if (parsed.flags.has(key)) {
    return true;
  }
  const value = parsed.options[key];
  if (typeof value === "undefined") {
    return defaultValue;
  }
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

export function getNumOption(parsed: ParsedArgs, key: string, defaultValue: number): number {
  const value = parsed.options[key];
  if (!value) {
    return defaultValue;
  }
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid numeric option --${key}: ${value}`);
  }
  return parsedValue;
}

export function resolvePath(p: string): string {
  return path.resolve(process.cwd(), p);
}

export function getDefaultFlowConfig(): FlowConfig {
  return {
    loginUrl: "https://auth.openai.com/log-in",
    loginButtonSelector: "",
    emailSelector: "input[type='email']",
    emailSubmitSelector: "button[type='submit']",
    passwordSelector: "input[type='password']",
    passwordSubmitSelector: "button[type='submit']",
    successUrlIncludes: ["code=", "callback", "redirect"],
    challengeSelectors: [
      "iframe[src*='captcha']",
      "[data-testid*='captcha']",
      "input[name='otp']",
      "input[autocomplete='one-time-code']"
    ],
    challengeTextPatterns: [
      "verification",
      "security check",
      "two-factor",
      "2-step",
      "验证码",
      "验证"
    ],
    localStorageKeys: [
      "refresh_token",
      "access_token",
      "id_token",
      "auth:refresh_token",
      "auth0.refresh_token"
    ],
    responseUrlPatterns: ["/oauth/token", "/token", "/authorize", "/signin"],
    accountType: "codex"
  };
}

function mergeFlowConfig(base: FlowConfig, override: Partial<FlowConfig>): FlowConfig {
  return {
    ...base,
    ...override,
    successUrlIncludes: override.successUrlIncludes ?? base.successUrlIncludes,
    challengeSelectors: override.challengeSelectors ?? base.challengeSelectors,
    challengeTextPatterns: override.challengeTextPatterns ?? base.challengeTextPatterns,
    localStorageKeys: override.localStorageKeys ?? base.localStorageKeys,
    responseUrlPatterns: override.responseUrlPatterns ?? base.responseUrlPatterns
  };
}

export function loadFlowConfig(configPath?: string): FlowConfig {
  const defaults = getDefaultFlowConfig();
  if (!configPath) {
    return defaults;
  }

  const absPath = resolvePath(configPath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`Flow config not found: ${absPath}`);
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  const parsed = JSON.parse(raw) as Partial<FlowConfig>;
  return mergeFlowConfig(defaults, parsed);
}
