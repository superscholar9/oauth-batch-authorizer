# Selector Strategy

Use robust selectors with localization fallback:

- Email input: `input[type="email"]`
- Password input: `input[type="password"]`
- Submit button: `button[type="submit"]`
- Password branch fallback text: `使用密码继续|Use password|Continue with password`
- Consent continue button text: `继续|Continue`

For CPAMC OAuth page:

- Open: `http://localhost:<port>/management.html#/oauth`
- Card text contains: `Codex OAuth`
- Start button text contains: `登录|开始|Log in|Start`

If page structure changes, prefer text-driven role selectors first, then specific CSS selectors.
