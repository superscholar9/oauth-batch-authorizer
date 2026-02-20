import { Frame, Page } from "playwright";
import { AccountCredential, FlowConfig } from "./types.js";

async function isVisibleIfExists(page: Page, selector?: string): Promise<boolean> {
  if (!selector) {
    return false;
  }
  const loc = page.locator(selector).first();
  return (await loc.count()) > 0 && (await loc.isVisible().catch(() => false));
}

export async function detectChallenge(page: Page, cfg: FlowConfig): Promise<boolean> {
  if (await onCodexConsentPage(page)) {
    return false;
  }

  for (const selector of cfg.challengeSelectors) {
    const loc = page.locator(selector).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return true;
    }
  }

  const html = (await page.content()).toLowerCase();
  const overlyBroad = new Set(["verification", "验证"]);
  return cfg.challengeTextPatterns
    .map((t) => t.toLowerCase())
    .filter((t) => !overlyBroad.has(t))
    .some((t) => html.includes(t));
}

function urlLooksSuccessful(url: string, cfg: FlowConfig): boolean {
  return cfg.successUrlIncludes.some((pattern) => url.includes(pattern));
}

async function frameLooksLikeConsent(frame: Frame): Promise<boolean> {
  const bodyText = (await frame.locator("body").innerText().catch(() => "")).slice(0, 12000);
  return /登录到 Codex|to Codex/i.test(bodyText);
}

async function onCodexConsentPage(page: Page): Promise<boolean> {
  for (const frame of page.frames()) {
    if (await frameLooksLikeConsent(frame)) {
      return true;
    }
  }
  return false;
}

async function clickConsentInFrame(frame: Frame): Promise<boolean> {
  return frame.evaluate(() => {
    const scrollables = Array.from(document.querySelectorAll("*"))
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        return (
          (overflowY === "auto" || overflowY === "scroll") &&
          (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 20
        );
      })
      .slice(0, 12) as HTMLElement[];

    for (const el of scrollables) {
      el.scrollTop = el.scrollHeight;
    }
    window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });

    const candidates = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='submit'], input[type='button']")
    ) as Array<HTMLElement | HTMLInputElement>;

    const target = candidates.find((el) => {
      const text = (el.textContent || (el as HTMLInputElement).value || "").trim();
      if (!text) return false;
      if (!/(继续|Continue)/i.test(text)) return false;
      if (/(取消|Cancel)/i.test(text)) return false;
      const disabled = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
      if (disabled) return false;
      return true;
    });

    if (!target) {
      return false;
    }

    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    target.click();
    return true;
  }).catch(() => false);
}

async function clickConsentContinueIfPresent(page: Page, timeoutMs: number): Promise<boolean> {
  if (!(await onCodexConsentPage(page))) {
    return false;
  }

  for (const frame of page.frames()) {
    if (!(await frameLooksLikeConsent(frame))) {
      continue;
    }
    const clicked = await clickConsentInFrame(frame);
    if (clicked) {
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }

  const continueButton = page
    .locator("button")
    .filter({ hasText: /继续|Continue/i })
    .filter({ hasNotText: /取消|Cancel/i })
    .last();

  if ((await continueButton.count()) > 0) {
    await continueButton.scrollIntoViewIfNeeded().catch(() => undefined);
    const enabled = await continueButton.isEnabled().catch(() => false);
    if (enabled) {
      await continueButton.click({ timeout: timeoutMs, force: true });
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
      return true;
    }
  }

  const clickedByScript = await clickConsentInFrame(page.mainFrame()).catch(() => false);

  if (clickedByScript) {
    await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    return true;
  }

  await page.keyboard.press("Tab").catch(() => undefined);
  await page.keyboard.press("Enter").catch(() => undefined);
  await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined);
  return false;
}

function pickActiveAuthPage(seedPage: Page): Page {
  const pages = seedPage.context().pages().filter((p) => !p.isClosed());
  for (let i = pages.length - 1; i >= 0; i--) {
    const p = pages[i];
    const url = p.url();
    if (/auth\.openai\.com|chatgpt\.com|localhost:\d+\/auth\/callback/i.test(url)) {
      return p;
    }
  }
  return pages[pages.length - 1] ?? seedPage;
}

export async function runLoginFlow(
  page: Page,
  account: AccountCredential,
  cfg: FlowConfig,
  timeoutMs: number,
  startUrl?: string
): Promise<{ finalUrl: string; challenge: boolean; invalidCredentials: boolean; callbackUrl?: string }> {
  await page.goto(startUrl ?? cfg.loginUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

  if (await isVisibleIfExists(page, cfg.loginButtonSelector)) {
    await page.locator(cfg.loginButtonSelector!).first().click({ timeout: timeoutMs });
  }

  await page.waitForSelector(cfg.emailSelector, { timeout: timeoutMs });
  await page.fill(cfg.emailSelector, account.email, { timeout: timeoutMs });

  if (cfg.emailSubmitSelector) {
    await page.locator(cfg.emailSubmitSelector).first().click({ timeout: timeoutMs });
  }

  const passwordLinkSelector = "a[href*='/log-in/password']";
  try {
    const passwordInputVisible = await isVisibleIfExists(page, cfg.passwordSelector);
    if (!passwordInputVisible) {
      await Promise.race([
        page.waitForSelector(cfg.passwordSelector, { timeout: 7000 }),
        page.waitForSelector(passwordLinkSelector, { timeout: 7000 })
      ]).catch(() => undefined);
    }
  } catch {
    // ignore
  }

  if (await isVisibleIfExists(page, passwordLinkSelector)) {
    await page.locator(passwordLinkSelector).first().click({ timeout: timeoutMs });
  } else {
    const passwordTextFallback = page
      .locator("a", { hasText: /使用密码继续|Use password|Continue with password/i })
      .first();
    if ((await passwordTextFallback.count()) > 0) {
      await passwordTextFallback.click({ timeout: timeoutMs });
    }
  }

  await page.waitForSelector(cfg.passwordSelector, { timeout: timeoutMs });
  await page.fill(cfg.passwordSelector, account.password, { timeout: timeoutMs });
  const popupAfterSubmitPromise = page.waitForEvent("popup", { timeout: 3000 }).catch(() => undefined);
  await page.locator(cfg.passwordSubmitSelector).first().click({ timeout: timeoutMs });
  const popupAfterSubmit = await popupAfterSubmitPromise;
  let activePage = popupAfterSubmit ?? page;
  await activePage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);

  const started = Date.now();
  let callbackUrl: string | undefined;
  while (Date.now() - started < timeoutMs) {
    activePage = pickActiveAuthPage(activePage);
    const invalidCredLocator = activePage
      .locator("text=/Incorrect email address or password|邮箱地址或密码错误|电子邮件地址或密码不正确/i")
      .first();

    const invalidCredentials =
      (await invalidCredLocator.count()) > 0 &&
      (await invalidCredLocator.isVisible().catch(() => false));
    if (invalidCredentials) {
      break;
    }

    const currentUrl = activePage.url();
    if (urlLooksSuccessful(currentUrl, cfg)) {
      break;
    }

    if (/localhost:\d+\/auth\/callback\?/.test(currentUrl) || /[?&]code=/.test(currentUrl)) {
      callbackUrl = currentUrl;
      break;
    }

    await clickConsentContinueIfPresent(activePage, timeoutMs).catch(() => undefined);

    const challengeNow = await detectChallenge(activePage, cfg);
    if (challengeNow) {
      break;
    }

    await activePage.waitForTimeout(700);
  }

  activePage = pickActiveAuthPage(activePage);
  const challenge = await detectChallenge(activePage, cfg);
  const invalidCredLocator = activePage
    .locator("text=/Incorrect email address or password|邮箱地址或密码错误|电子邮件地址或密码不正确/i")
    .first();
  const invalidCredentials =
    (await invalidCredLocator.count()) > 0 &&
    (await invalidCredLocator.isVisible().catch(() => false));
  const finalUrl = activePage.url();
  if (!callbackUrl && (/localhost:\d+\/auth\/callback\?/.test(finalUrl) || /[?&]code=/.test(finalUrl))) {
    callbackUrl = finalUrl;
  }
  return { finalUrl, challenge, invalidCredentials, callbackUrl };
}
