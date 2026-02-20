# Input Schema

Account JSON must be an array:

```json
[
  { "email": "user@example.com", "password": "secret", "plan": "free" }
]
```

Markdown format for extraction:

```text
user1@example.com----password1
user2@example.com----password2
```

Rules:

- Delimiter is `----`
- Keep last entry for duplicate email
- Invalid email or empty password lines are reported and skipped
