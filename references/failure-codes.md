# Failure Codes

- `INVALID_INPUT`: Input markdown/json format invalid.
- `LOGIN_REJECTED`: Password incorrect or login rejected.
- `CHALLENGE_REQUIRED`: Captcha/2FA/extra verification encountered.
- `TOKEN_NOT_FOUND`: Token not found from expected source.
- `WRITE_FAILED`: Auth succeeded but target token file not written/found.
- `CPAMC_LOGIN_FAILED`: CPAMC management login failed.
- `CPAMC_LINK_NOT_FOUND`: CPAMC auth URL/state cannot be found.
- `CPAMC_OAUTH_FAILED`: CPAMC reports OAuth failed or timed out.
- `CALLBACK_URL_NOT_CAPTURED`: Callback URL was expected but not captured.
- `CALLBACK_SUBMIT_FAILED`: Callback submit API failed.
- `UNKNOWN`: Unknown runtime failure.
