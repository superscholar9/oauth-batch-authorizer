---
name: oauth-batch-authorizer
description: "Automate multi-account OAuth authorization through CLI Proxy API Management Center (CPAMC) with Playwright. Use when users need to parse account/password lists from markdown or JSON, log into CPAMC, trigger Codex OAuth links from the built-in OAuth page, complete account password login, and build rotation indexes from saved auth files."
---

# OAuth Batch Authorizer

Use this skill to run batch account credential extraction, CPAMC OAuth automation, and rotation index generation.

## Prerequisites

1. Playwright MCP must be available in your Codex/Claude Code environment (for browser automation).
2. You must provide plaintext management key via `--management-key` (or `CPA_MANAGEMENT_KEY` env).
3. Do not rely on `config.yaml` to read management key.

## Workflow

1. Normalize account input:
   - Parse `email----password` lines from markdown.
   - Validate email format and non-empty password.
   - Deduplicate by email (keep last entry).
2. Run batch auth:
   - Load account JSON.
   - Log into CPAMC management center with plaintext management key from user input.
   - Go to OAuth page and start Codex OAuth for each account.
   - Open CPAMC-generated auth URL and execute account password login.
   - Handle OAuth consent page (`使用 ChatGPT 登录到 Codex`) by clicking `继续` automatically (including popup/iframe cases).
   - Process accounts strictly in sequence: do not start next account before current account receives CPAMC auth result.
   - Let CPAMC auto-save auth files.
   - Skip and report accounts that hit challenge flows.
3. Verify auth files:
   - Wait for CPAMC to save one `codex-*.json` per successful account.
4. Build rotation index:
   - Scan token files and classify `active/expired/disabled`.
   - Merge newly scanned accounts into existing `accounts-index.json` (do not overwrite existing entries).

## Safety Rules

1. Never print full passwords or full tokens.
2. Never attempt captcha or 2FA bypass.
3. Mark challenge-required accounts as failed and continue.
4. Keep management key and auth files local.

## Commands

Install dependencies:

```bash
npm install
```

Extract markdown accounts:

```bash
npm run extract -- --input ./input/accounts.md --out ./input/accounts.json --report ./input/accounts-report.json
```

Dry run auth:

```bash
npm run auth:dry -- \
  --input ./input/accounts.json \
  --management-key <PLAINTEXT_MANAGEMENT_KEY>
```

Run auth:

```bash
npm run auth:run -- \
  --input ./input/accounts.json \
  --management-key <PLAINTEXT_MANAGEMENT_KEY> \
  --headful true \
  --browser-path "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

Build rotation index:

```bash
npm run rotate:index -- --dir ../../../../.cli-proxy-api --out ../../../../.cli-proxy-api/accounts-index.json
```

## Files

1. `scripts/src/main.ts` - Command entrypoint (`extract`, `auth`, `rotate-index`)
2. `scripts/src/cpamc.ts` - CPAMC login, OAuth URL startup, auth status polling
3. `scripts/src/login-flow.ts` - Browser login flow and challenge detection
4. `scripts/src/rotate.ts` - Index builder for account rotation
5. `references/selector-strategy.md` - Selector customization guide
6. `references/failure-codes.md` - Failure code meanings
