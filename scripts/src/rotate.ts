import fs from "node:fs";
import path from "node:path";
import { RotateAccountEntry, RotateIndex } from "./types.js";

interface MaybeToken {
  email?: unknown;
  expired?: unknown;
  disabled?: unknown;
}

function classify(file: string): RotateAccountEntry {
  try {
    const raw = fs.readFileSync(file, "utf-8");
    const data = JSON.parse(raw) as MaybeToken;
    const email = typeof data.email === "string" ? data.email : path.basename(file);
    const disabled = data.disabled === true;
    const expired = typeof data.expired === "string" ? data.expired : undefined;

    if (disabled) {
      return { email, file, expired, status: "disabled" };
    }

    if (expired) {
      const exp = Date.parse(expired);
      if (Number.isFinite(exp) && exp < Date.now()) {
        return { email, file, expired, status: "expired" };
      }
    }

    return { email, file, expired, status: "active" };
  } catch {
    return { email: path.basename(file), file, status: "invalid" };
  }
}

export function buildRotationIndex(dir: string): RotateIndex {
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.startsWith("codex-") && d.name.endsWith(".json"))
    .map((d) => path.join(dir, d.name));

  const accounts = files.map(classify);
  const active = accounts.filter((a) => a.status === "active").length;
  const expired = accounts.filter((a) => a.status === "expired").length;
  const disabled = accounts.filter((a) => a.status === "disabled").length;
  const invalid = accounts.filter((a) => a.status === "invalid").length;

  return {
    generated_at: new Date().toISOString(),
    total: accounts.length,
    active,
    expired,
    disabled,
    invalid,
    accounts
  };
}

function accountKey(entry: RotateAccountEntry): string {
  return `${entry.email.toLowerCase()}|${path.basename(entry.file).toLowerCase()}`;
}

export function writeRotationIndex(outPath: string, index: RotateIndex): void {
  let existingAccounts: RotateAccountEntry[] = [];
  if (fs.existsSync(outPath)) {
    try {
      const raw = fs.readFileSync(outPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<RotateIndex>;
      if (Array.isArray(parsed.accounts)) {
        existingAccounts = parsed.accounts
          .filter((x): x is RotateAccountEntry => {
            return !!x && typeof x === "object" && typeof (x as RotateAccountEntry).email === "string" && typeof (x as RotateAccountEntry).file === "string";
          });
      }
    } catch {
      // Ignore malformed previous index and write a fresh merged file.
    }
  }

  const merged = new Map<string, RotateAccountEntry>();
  for (const acc of existingAccounts) {
    merged.set(accountKey(acc), acc);
  }
  for (const acc of index.accounts) {
    merged.set(accountKey(acc), acc);
  }

  const mergedAccounts = [...merged.values()];
  const finalIndex: RotateIndex = {
    generated_at: new Date().toISOString(),
    total: mergedAccounts.length,
    active: mergedAccounts.filter((a) => a.status === "active").length,
    expired: mergedAccounts.filter((a) => a.status === "expired").length,
    disabled: mergedAccounts.filter((a) => a.status === "disabled").length,
    invalid: mergedAccounts.filter((a) => a.status === "invalid").length,
    accounts: mergedAccounts
  };

  fs.writeFileSync(outPath, JSON.stringify(finalIndex, null, 2), "utf-8");
}
