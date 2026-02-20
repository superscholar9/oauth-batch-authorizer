import fs from "node:fs";
import path from "node:path";
import { AccountCredential, ExtractError, ExtractReport } from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function writeJsonFile(outputPath: string, data: unknown): void {
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
}

export function loadAccountJson(inputPath: string, defaultPlan: string): AccountCredential[] {
  const raw = fs.readFileSync(inputPath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Account input must be a JSON array");
  }

  const accounts: AccountCredential[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const email = typeof obj.email === "string" ? obj.email.trim() : "";
    const password = typeof obj.password === "string" ? obj.password : "";
    const plan = typeof obj.plan === "string" && obj.plan.trim() ? obj.plan.trim() : defaultPlan;
    if (!email || !EMAIL_RE.test(email) || !password) {
      continue;
    }
    accounts.push({ email, password, plan });
  }

  if (accounts.length === 0) {
    throw new Error("No valid accounts found in input JSON");
  }
  return accounts;
}

export function parseMarkdownAccounts(inputPath: string, defaultPlan: string): { accounts: AccountCredential[]; report: ExtractReport } {
  const lines = fs.readFileSync(inputPath, "utf-8").split(/\r?\n/);
  const errors: ExtractError[] = [];
  const byEmail = new Map<string, AccountCredential>();
  let invalid = 0;

  lines.forEach((line, idx) => {
    const text = line.trim();
    if (!text) return;

    const split = text.split("----");
    if (split.length < 2) {
      invalid++;
      errors.push({
        line: idx + 1,
        code: "MISSING_DELIMITER",
        message: "Line must contain delimiter ----"
      });
      return;
    }

    const email = split[0].trim();
    const password = split.slice(1).join("----");

    if (!EMAIL_RE.test(email)) {
      invalid++;
      errors.push({
        line: idx + 1,
        code: "INVALID_EMAIL",
        message: "Invalid email format"
      });
      return;
    }

    if (!password) {
      invalid++;
      errors.push({
        line: idx + 1,
        code: "EMPTY_PASSWORD",
        message: "Password cannot be empty"
      });
      return;
    }

    byEmail.set(email.toLowerCase(), { email, password, plan: defaultPlan });
  });

  const accounts = [...byEmail.values()];
  const report: ExtractReport = {
    generated_at: new Date().toISOString(),
    total_lines: lines.length,
    valid_accounts: accounts.length,
    invalid_lines: invalid,
    duplicate_emails: Math.max(0, lines.filter((l) => l.trim()).length - invalid - accounts.length),
    errors
  };

  return { accounts, report };
}

export function makeTokenOutputPath(outDir: string, account: AccountCredential): string {
  const safeEmail = account.email.replace(/[\\/:*?"<>|]/g, "_");
  return path.join(outDir, `codex-${safeEmail}-${account.plan ?? "free"}.json`);
}
