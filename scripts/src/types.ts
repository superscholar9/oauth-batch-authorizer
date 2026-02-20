export type FailureCode =
  | "INVALID_INPUT"
  | "LOGIN_REJECTED"
  | "CHALLENGE_REQUIRED"
  | "TOKEN_NOT_FOUND"
  | "WRITE_FAILED"
  | "CPAMC_LOGIN_FAILED"
  | "CPAMC_LINK_NOT_FOUND"
  | "CPAMC_OAUTH_FAILED"
  | "CALLBACK_URL_NOT_CAPTURED"
  | "CALLBACK_SUBMIT_FAILED"
  | "UNKNOWN";

export interface AccountCredential {
  email: string;
  password: string;
  plan?: string;
}

export interface TokenRecord {
  access_token?: string;
  account_id?: string;
  disabled: boolean;
  email: string;
  expired?: string;
  id_token?: string;
  last_refresh: string;
  refresh_token: string;
  type: string;
}

export interface AuthResult {
  email: string;
  plan: string;
  status: "success" | "failed" | "skipped";
  code?: FailureCode;
  message?: string;
  file?: string;
  started_at: string;
  ended_at: string;
}

export interface ExtractError {
  line: number;
  code: "INVALID_EMAIL" | "MISSING_DELIMITER" | "EMPTY_PASSWORD";
  message: string;
}

export interface ExtractReport {
  generated_at: string;
  total_lines: number;
  valid_accounts: number;
  invalid_lines: number;
  duplicate_emails: number;
  errors: ExtractError[];
}

export interface RotateAccountEntry {
  email: string;
  file: string;
  expired?: string;
  status: "active" | "expired" | "disabled" | "invalid";
}

export interface RotateIndex {
  generated_at: string;
  total: number;
  active: number;
  expired: number;
  disabled: number;
  invalid: number;
  accounts: RotateAccountEntry[];
}

export interface FlowConfig {
  loginUrl: string;
  loginButtonSelector?: string;
  emailSelector: string;
  emailSubmitSelector?: string;
  passwordSelector: string;
  passwordSubmitSelector: string;
  successUrlIncludes: string[];
  challengeSelectors: string[];
  challengeTextPatterns: string[];
  localStorageKeys: string[];
  responseUrlPatterns: string[];
  accountType: string;
}

export interface NetworkTokenSnapshot {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  account_id?: string;
}
