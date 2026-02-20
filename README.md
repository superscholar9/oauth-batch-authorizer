# oauth-batch-authorizer

Batch OAuth authorization skill for CLI Proxy API Management Center (CPAMC).

## Requirements

- Playwright MCP available in your Codex/Claude Code runtime (this skill uses browser automation)
- Node.js 18+ and npm
- Plaintext CPAMC management key provided by user (`--management-key` or `CPA_MANAGEMENT_KEY`)

## What This Skill Does

- Parse account/password lists from markdown (`email----password`)
- Open CPAMC OAuth page and trigger Codex OAuth
- Auto-fill account/password with Playwright
- Auto-handle consent page (`使用 ChatGPT 登录到 Codex` -> `继续`)
- Process accounts strictly one-by-one
- Wait for CPAMC result and verify `codex-*.json` output files
- Build rotation index for multi-account token management
- Merge new index entries into existing `accounts-index.json` (no blind overwrite)

## Repository Layout

```text
oauth-batch-authorizer/
├─ SKILL.md
├─ references/
│  ├─ failure-codes.md
│  └─ selector-strategy.md
└─ scripts/
   ├─ package.json
   └─ src/
      ├─ main.ts
      ├─ cpamc.ts
      ├─ login-flow.ts
      ├─ io.ts
      ├─ rotate.ts
      └─ types.ts
```

## Install In Codex

Option A (recommended, direct clone):

```powershell
git clone https://github.com/superscholar9/oauth-batch-authorizer.git "$HOME/.agents/skills/oauth-batch-authorizer"
```

Option B (if your Codex uses `$CODEX_HOME/skills`):

```powershell
git clone https://github.com/superscholar9/oauth-batch-authorizer.git "$env:CODEX_HOME/skills/oauth-batch-authorizer"
```

## Install In Claude Code

Most setups use `~/.claude/skills`:

```powershell
git clone https://github.com/superscholar9/oauth-batch-authorizer.git "$HOME/.claude/skills/oauth-batch-authorizer"
```

If your Claude Code uses a custom skills path, clone to that path instead.

## Quick Start

```powershell
cd "$HOME/.agents/skills/oauth-batch-authorizer/scripts"
npm install
```

Extract accounts from markdown:

```powershell
npm run extract -- --input "D:/desktop/user.md" --out "C:/Users/MECHREVO/.cli-proxy-api/input/accounts.json" --report "C:/Users/MECHREVO/.cli-proxy-api/input/accounts-report.json"
```

Run batch authorization:

```powershell
npm run auth:run -- --input "C:/Users/MECHREVO/.cli-proxy-api/input/accounts.json" --management-key "my_password" --out-dir "C:/Users/MECHREVO/.cli-proxy-api" --headful true --browser-path "C:/Program Files/Google/Chrome/Application/chrome.exe" --timeout-ms 120000 --delay-ms 1000 --report "C:/Users/MECHREVO/.cli-proxy-api/batch-report.json"
```

Build rotation index:

```powershell
npm run rotate:index -- --dir "C:/Users/MECHREVO/.cli-proxy-api" --out "C:/Users/MECHREVO/.cli-proxy-api/accounts-index.json"
```

## Notes

- Do not store plaintext passwords in public repositories.
- Do not print full tokens or secrets in logs.
- Captcha/2FA accounts should be skipped and retried manually if needed.
- This skill does not read management key from `config.yaml`; pass plaintext key explicitly.
