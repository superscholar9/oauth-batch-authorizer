import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  getBoolOption,
  getNumOption,
  loadFlowConfig,
  parseArgs,
  requireOption,
  resolvePath
} from "./config.js";
import {
  buildCpamcBaseUrl,
  ensureCpamcLogin,
  getStateFromAuthUrl,
  gotoOauthPage,
  pollCpamcAuthStatus,
  startCodexOauthAndGetUrl,
  waitForAuthFileByEmail
} from "./cpamc.js";
import { loadAccountJson, makeTokenOutputPath, parseMarkdownAccounts, writeJsonFile } from "./io.js";
import { detectChallenge, runLoginFlow } from "./login-flow.js";
import { buildRotationIndex, writeRotationIndex } from "./rotate.js";
import { AuthResult } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 1) return "***";
  return `${email.slice(0, 2)}***${email.slice(at)}`;
}

function pickManagementKey(fromArg: string | undefined): string {
  const fromEnv = process.env.CPA_MANAGEMENT_KEY;
  const chosen = fromArg ?? fromEnv;
  if (!chosen) {
    throw new Error("Management key is required. Pass --management-key (plaintext) or set CPA_MANAGEMENT_KEY.");
  }

  return chosen;
}

async function runExtractCommand(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const input = resolvePath(requireOption(parsed, "input"));
  const output = resolvePath(parsed.options.out ?? path.join(path.dirname(input), "accounts.json"));
  const report = resolvePath(parsed.options.report ?? path.join(path.dirname(input), "accounts-report.json"));
  const plan = parsed.options.plan ?? "free";

  const { accounts, report: extractReport } = parseMarkdownAccounts(input, plan);
  writeJsonFile(output, accounts);
  writeJsonFile(report, extractReport);

  console.log(`Extracted accounts: ${accounts.length}`);
  console.log(`Invalid lines: ${extractReport.invalid_lines}`);
  console.log(`Duplicate emails replaced: ${extractReport.duplicate_emails}`);
  console.log(`Accounts output: ${output}`);
  console.log(`Report output: ${report}`);
}

async function runAuthCommand(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const input = resolvePath(requireOption(parsed, "input"));
  const dryRun = getBoolOption(parsed, "dry-run", false);
  const headful = getBoolOption(parsed, "headful", true);
  const timeoutMs = getNumOption(parsed, "timeout-ms", 120000);
  const delayMs = getNumOption(parsed, "delay-ms", 1200);
  const defaultPlan = parsed.options.plan ?? "free";
  const browserChannel = parsed.options["browser-channel"];
  const browserPath = parsed.options["browser-path"];

  const managementKey = pickManagementKey(parsed.options["management-key"]);

  const portOverride = parsed.options["cpamc-port"] ? Number(parsed.options["cpamc-port"]) : undefined;
  const cpamcBaseUrl =
    parsed.options["cpamc-base-url"] ?? buildCpamcBaseUrl(Number.isFinite(portOverride) ? Number(portOverride) : 8317);

  const outDir = resolvePath(parsed.options["out-dir"] ?? path.join(os.homedir(), ".cli-proxy-api"));
  const reportPath = resolvePath(parsed.options.report ?? path.join(outDir, "batch-report.json"));

  const flow = loadFlowConfig(parsed.options["flow-config"]);
  const accounts = loadAccountJson(input, defaultPlan);
  const results: AuthResult[] = [];

  if (dryRun) {
    for (const account of accounts) {
      const started = new Date().toISOString();
      const ended = new Date().toISOString();
      const outputFile = makeTokenOutputPath(outDir, account);
      results.push({
        email: account.email,
        plan: account.plan ?? defaultPlan,
        status: "skipped",
        code: "UNKNOWN",
        message: `Dry run only. Planned output: ${outputFile}`,
        started_at: started,
        ended_at: ended
      });
    }

    const summary = {
      generated_at: new Date().toISOString(),
      mode: "dry-run",
      total: results.length,
      success: 0,
      failed: 0,
      skipped: results.length,
      cpamc_base_url: cpamcBaseUrl,
      auth_dir: outDir,
      results
    };
    writeJsonFile(reportPath, summary);
    console.log(`Dry run complete. Accounts planned: ${results.length}`);
    console.log(`CPAMC base URL: ${cpamcBaseUrl}`);
    console.log(`Auth dir: ${outDir}`);
    console.log(`Report output: ${reportPath}`);
    return;
  }

  const browser = await chromium.launch({
    headless: !headful,
    channel: browserChannel,
    executablePath: browserPath ? resolvePath(browserPath) : undefined
  });

  try {
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      const startedAt = new Date().toISOString();
      const displayEmail = redactEmail(account.email);
      console.log(`Processing [${i + 1}/${accounts.length}] ${displayEmail}`);

      const context = await browser.newContext();
      let controlPage = undefined as Awaited<ReturnType<typeof context.newPage>> | undefined;
      let authPage = undefined as Awaited<ReturnType<typeof context.newPage>> | undefined;
      try {
        controlPage = await context.newPage();
        await ensureCpamcLogin(controlPage, cpamcBaseUrl, managementKey, timeoutMs);
        await gotoOauthPage(controlPage, cpamcBaseUrl, timeoutMs);

        const authUrl = await startCodexOauthAndGetUrl(controlPage, timeoutMs, managementKey);
        const state = getStateFromAuthUrl(authUrl);
        if (!state) {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "CPAMC_LINK_NOT_FOUND",
            message: "Auth URL state not found.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        authPage = await context.newPage();
        const flowResult = await runLoginFlow(authPage, account, flow, timeoutMs, authUrl);

        const challenge = flowResult.challenge || (await detectChallenge(authPage, flow));
        const settleTimeoutMs = flowResult.invalidCredentials || challenge ? Math.min(timeoutMs, 30000) : timeoutMs;
        const status = await pollCpamcAuthStatus(controlPage, state, settleTimeoutMs, managementKey);

        if (flowResult.invalidCredentials) {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "LOGIN_REJECTED",
            message: status.message ?? "Incorrect email address or password.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        if (challenge) {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "CHALLENGE_REQUIRED",
            message: status.message ?? "Challenge detected (captcha/2FA/verification). Skipped account.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        if (status.status === "error") {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "CPAMC_OAUTH_FAILED",
            message: status.message ?? "CPAMC OAuth reported failure.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        if (status.status === "waiting") {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "CPAMC_OAUTH_FAILED",
            message: "Timed out waiting CPAMC authentication result.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        const file = await waitForAuthFileByEmail(outDir, account.email, timeoutMs);
        if (!file) {
          results.push({
            email: account.email,
            plan: account.plan ?? defaultPlan,
            status: "failed",
            code: "WRITE_FAILED",
            message: "OAuth completed but auth file not found.",
            started_at: startedAt,
            ended_at: new Date().toISOString()
          });
          continue;
        }

        results.push({
          email: account.email,
          plan: account.plan ?? defaultPlan,
          status: "success",
          file,
          started_at: startedAt,
          ended_at: new Date().toISOString()
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const lower = message.toLowerCase();
        const code =
          lower.includes("management key") ? "CPAMC_LOGIN_FAILED" :
          lower.includes("auth url") ? "CPAMC_LINK_NOT_FOUND" :
          lower.includes("timeout") ? "LOGIN_REJECTED" : "UNKNOWN";
        results.push({
          email: account.email,
          plan: account.plan ?? defaultPlan,
          status: "failed",
          code,
          message,
          started_at: startedAt,
          ended_at: new Date().toISOString()
        });
      } finally {
        if (authPage) {
          await authPage.close().catch(() => undefined);
        }
        await context.close().catch(() => undefined);
      }

      await sleep(delayMs);
    }
  } finally {
    await browser.close();
  }

  const summary = {
    generated_at: new Date().toISOString(),
    mode: "run",
    total: results.length,
    success: results.filter((r) => r.status === "success").length,
    failed: results.filter((r) => r.status === "failed").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    cpamc_base_url: cpamcBaseUrl,
    auth_dir: outDir,
    results
  };
  writeJsonFile(reportPath, summary);
  console.log(`Auth run complete. Success: ${summary.success}, Failed: ${summary.failed}`);
  console.log(`Report output: ${reportPath}`);
}

async function runRotateIndexCommand(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  const dir = resolvePath(requireOption(parsed, "dir"));
  const out = resolvePath(parsed.options.out ?? path.join(dir, "accounts-index.json"));
  const index = buildRotationIndex(dir);
  writeRotationIndex(out, index);
  console.log(`Rotation index written: ${out}`);
  console.log(
    `Totals - active: ${index.active}, expired: ${index.expired}, disabled: ${index.disabled}, invalid: ${index.invalid}`
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command) {
    throw new Error("Missing command. Use: extract | auth | rotate-index");
  }

  if (command === "extract") {
    await runExtractCommand(argv);
    return;
  }
  if (command === "auth") {
    await runAuthCommand(argv);
    return;
  }
  if (command === "rotate-index") {
    await runRotateIndexCommand(argv);
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
