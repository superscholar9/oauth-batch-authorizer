import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Page } from "playwright";

export interface CpaConfig {
  port: number;
  authDir: string;
  secretKeyRaw?: string;
}

export interface CpamcAuthStatus {
  status: "success" | "error" | "waiting";
  raw?: string;
  message?: string;
}

function parseScalar(raw: string): string {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

export function loadCpaConfig(configPath: string): CpaConfig {
  const raw = fs.readFileSync(configPath, "utf-8");
  const portMatch = raw.match(/^\s*port:\s*(\d+)\s*$/m);
  const authDirMatch = raw.match(/^\s*auth-dir:\s*(.+)\s*$/m);
  const secretKeyMatch = raw.match(/^\s*secret-key:\s*(.+)\s*$/m);

  const port = portMatch ? Number(portMatch[1]) : 8317;
  const authDir = authDirMatch ? expandHome(parseScalar(authDirMatch[1])) : path.join(os.homedir(), ".cli-proxy-api");
  const secretKeyRaw = secretKeyMatch ? parseScalar(secretKeyMatch[1]) : undefined;

  return { port, authDir, secretKeyRaw };
}

export function buildCpamcBaseUrl(port: number): string {
  return `http://localhost:${port}`;
}

export function looksLikeBcryptHash(value?: string): boolean {
  if (!value) return false;
  return /^\$2[aby]\$\d{2}\$/.test(value);
}

export async function ensureCpamcLogin(
  page: Page,
  baseUrl: string,
  managementKey: string,
  timeoutMs: number
): Promise<void> {
  await page.goto(`${baseUrl}/management.html`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForTimeout(1000);

  const keyInput = page.locator("input[placeholder*='管理密钥'], input[placeholder*='Management Key']").first();
  if ((await keyInput.count()) === 0) {
    return;
  }

  await keyInput.fill(managementKey, { timeout: timeoutMs });
  const loginBtn = page.getByRole("button", { name: /登录|Log in|Sign in|Connect/i }).first();
  await loginBtn.click({ timeout: timeoutMs });

  const invalidKey = page.locator("text=/管理密钥无效|invalid management key|Authentication failed/i").first();
  const loginFormStillVisible = async (): Promise<boolean> => {
    const count = await keyInput.count();
    if (count === 0) return false;
    return keyInput.isVisible().catch(() => false);
  };

  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if ((await invalidKey.count()) > 0 && (await invalidKey.isVisible().catch(() => false))) {
      throw new Error("CPAMC login failed: invalid management key");
    }

    if (!(await loginFormStillVisible())) {
      return;
    }
    await page.waitForTimeout(500);
  }

  throw new Error("CPAMC login failed: timeout waiting for dashboard");
}

export async function gotoOauthPage(page: Page, baseUrl: string, timeoutMs: number): Promise<void> {
  await page.goto(`${baseUrl}/management.html#/oauth`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => /Codex OAuth/i.test(document.body.innerText), { timeout: timeoutMs });
}

function extractAuthUrlFromText(text: string): string | undefined {
  const m = text.match(/https:\/\/auth\.openai\.com\/oauth\/authorize[^\s"'`）)]*/i);
  return m?.[0];
}

export async function startCodexOauthAndGetUrl(
  page: Page,
  timeoutMs: number,
  managementKey?: string
): Promise<string> {
  const card = page.locator("div", { hasText: /Codex OAuth/i }).first();
  await card.waitFor({ timeout: timeoutMs });

  const beforeText = await card.innerText().catch(() => "");
  const previousUrl = extractAuthUrlFromText(beforeText);
  const previousState = previousUrl ? getStateFromAuthUrl(previousUrl) : undefined;

  const startBtn = card.getByRole("button", { name: /登录|开始|Log in|Start/i }).first();
  let clickedStart = false;
  if ((await startBtn.count()) > 0) {
    const waitEnabledStarted = Date.now();
    const waitEnabledTimeout = Math.min(timeoutMs, 30000);
    while (Date.now() - waitEnabledStarted < waitEnabledTimeout) {
      const enabled = await startBtn.isEnabled().catch(() => false);
      if (enabled) {
        await startBtn.click({ timeout: timeoutMs });
        clickedStart = true;
        break;
      }
      await page.waitForTimeout(400);
    }
  }

  const readUrlTimeout = clickedStart ? timeoutMs : Math.min(timeoutMs, 4000);
  const started = Date.now();
  while (Date.now() - started < readUrlTimeout) {
    const text = await card.innerText().catch(() => "");
    const maybe = extractAuthUrlFromText(text);
    if (maybe) {
      const state = getStateFromAuthUrl(maybe);
      if (!previousState || state !== previousState || clickedStart) {
        return maybe;
      }
    }
    await page.waitForTimeout(400);
  }

  const fallbackUrl = await page.evaluate(async (key) => {
    const headers: Record<string, string> = {};
    if (key) {
      headers.Authorization = `Bearer ${key}`;
    }

    const resp = await fetch("/v0/management/codex-auth-url?is_webui=true", {
      method: "GET",
      credentials: "include",
      headers
    });
    const text = await resp.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      // keep raw text
    }

    if (typeof data === "string" && data.startsWith("http")) {
      return data;
    }

    if (!data || typeof data !== "object") {
      return "";
    }

    const obj = data as Record<string, unknown>;
    const candidates = ["url", "auth_url", "authorize_url", "authorization_url"];
    for (const key2 of candidates) {
      const value = obj[key2];
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
    }

    const nested = obj.data;
    if (!nested || typeof nested !== "object") {
      return "";
    }

    const nestedObj = nested as Record<string, unknown>;
    for (const key2 of candidates) {
      const value = nestedObj[key2];
      if (typeof value === "string" && value.startsWith("http")) {
        return value;
      }
    }

    return "";
  }, managementKey);

  if (fallbackUrl) {
    const state = getStateFromAuthUrl(fallbackUrl);
    if (!previousState || state !== previousState || clickedStart) {
      return fallbackUrl;
    }
  }

  if (!clickedStart && (await startBtn.count()) > 0) {
    const enabled = await startBtn.isEnabled().catch(() => false);
    if (!enabled) {
      throw new Error("CPAMC OAuth start button is disabled; previous authentication may still be in progress.");
    }
  }

  if (previousUrl) {
    return previousUrl;
  }

  if (fallbackUrl) {
    return fallbackUrl;
  }

  throw new Error("CPAMC OAuth auth URL not found");
}

export function getStateFromAuthUrl(authUrl: string): string | undefined {
  try {
    const parsed = new URL(authUrl);
    return parsed.searchParams.get("state") ?? undefined;
  } catch {
    return undefined;
  }
}

function normalizeStatus(statusRaw: string): CpamcAuthStatus["status"] {
  const s = statusRaw.toLowerCase();
  if (/(success|ok|done|completed|认证成功|已成功)/.test(s)) return "success";
  if (/(error|fail|failed|denied|invalid|认证失败)/.test(s)) return "error";
  return "waiting";
}

function pickTextValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseStatusPayload(payload: unknown): { statusRaw: string; message: string; raw: string } {
  if (!payload || typeof payload !== "object") {
    const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
    return { statusRaw: raw, message: raw, raw };
  }

  const obj = payload as Record<string, unknown>;
  const data = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : undefined;
  const statusRaw = pickTextValue(obj.status, obj.state, data?.status, data?.state, obj.result, data?.result);
  const message = pickTextValue(obj.message, obj.msg, obj.error, data?.message, data?.msg, data?.error, statusRaw);
  const raw = JSON.stringify(obj);
  return { statusRaw: statusRaw || raw, message, raw };
}

export async function pollCpamcAuthStatus(
  page: Page,
  state: string | undefined,
  timeoutMs: number,
  managementKey?: string
): Promise<CpamcAuthStatus> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (state) {
      const result = await page.evaluate(
        async ({ st, key }) => {
          const headers: Record<string, string> = {};
          if (key) {
            headers.Authorization = `Bearer ${key}`;
          }
          const resp = await fetch(`/v0/management/get-auth-status?state=${encodeURIComponent(st)}`, {
            method: "GET",
            credentials: "include",
            headers
          });
          const text = await resp.text();
          let parsed: unknown = text;
          try {
            parsed = JSON.parse(text);
          } catch {
            // keep raw text
          }
          return { httpStatus: resp.status, text, parsed };
        },
        { st: state, key: managementKey }
      );

      const parsedPayload = parseStatusPayload(result.parsed);
      const normalizedFromPayload = normalizeStatus(parsedPayload.statusRaw);
      if (normalizedFromPayload !== "waiting") {
        return {
          status: normalizedFromPayload,
          raw: parsedPayload.raw || result.text,
          message: parsedPayload.message || parsedPayload.statusRaw
        };
      }

      const normalizedFromRaw = normalizeStatus(result.text);
      if (normalizedFromRaw !== "waiting") {
        return { status: normalizedFromRaw, raw: result.text, message: result.text };
      }
    } else {
      const uiStatus = await page.evaluate(() => {
        const text = document.body.innerText || "";
        if (/认证成功|Authentication successful|OAuth success|认证完成/i.test(text)) {
          return { status: "success", message: text.slice(0, 600) };
        }
        if (/认证失败|Authentication failed|OAuth failed/i.test(text)) {
          return { status: "error", message: text.slice(0, 600) };
        }
        return { status: "waiting", message: "" };
      });

      if (uiStatus.status === "success" || uiStatus.status === "error") {
        return { status: uiStatus.status, message: uiStatus.message };
      }
    }

    await page.waitForTimeout(1000);
  }

  return { status: "waiting", message: "Timed out waiting auth status" };
}

export async function submitCpamcCallback(
  page: Page,
  provider: string,
  redirectUrl: string
): Promise<{ ok: boolean; httpStatus: number; raw: string }> {
  const response = await page.evaluate(
    async ({ p, url }) => {
      const resp = await fetch("/v0/management/oauth-callback", {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          provider: p,
          redirect_url: url
        })
      });
      const text = await resp.text();
      return {
        ok: resp.ok,
        httpStatus: resp.status,
        raw: text
      };
    },
    { p: provider, url: redirectUrl }
  );

  return response;
}

export async function waitForAuthFileByEmail(
  authDir: string,
  email: string,
  timeoutMs: number
): Promise<string | undefined> {
  const lowerEmail = email.toLowerCase();
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const entries = fs.readdirSync(authDir, { withFileTypes: true });
    const files = entries
      .filter((d) => d.isFile() && d.name.startsWith("codex-") && d.name.endsWith(".json"))
      .map((d) => path.join(authDir, d.name));

    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, "utf-8");
        const data = JSON.parse(raw) as { email?: unknown };
        if (typeof data.email === "string" && data.email.toLowerCase() === lowerEmail) {
          return file;
        }
      } catch {
        // ignore malformed file while waiting for writes to finish
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return undefined;
}
