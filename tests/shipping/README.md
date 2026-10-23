# Offline LIVCASH tests

Run with the installed Node 24 and TypeScript; no installation or env file needed:

```
node --import ./tests/shipping/offline-loader.mjs --test tests/shipping/livcash.test.mjs
```

The test-only loader transpiles TypeScript in memory, replaces Next.js's
`server-only` marker, and blocks global fetch. Every carrier response uses an
injected mock. The application retains the real server-only import, resolved by
Next.js's server/client build boundary. This suite does not verify a Next.js build.

Application safety limits (not documented carrier constraints): city 120 chars,
name 200, address/note 1000, tracking 128, quantity 1–10000, decimal text 32 chars,
response 64 KiB, timeout 100–60000 ms (default 15000). Phone accepts unformatted
Moroccan 05/06/07 numbers and explicit international forms without changing them.
Zero COD is syntactically allowed; carrier acceptance is not guaranteed. No city
aliases, currency rounding, tracking generation or automatic retries exist.

LIVCASH_API_TOKEN is server-only. LIVCASH_SUBMISSION_ENABLED and
LIVCASH_TRACKING_ENABLED require exact `true` and a nonempty token; both default
off. LIVCASH_TIMEOUT_MS optionally configures the deadline. Never log the config.
Do not add these settings to real environments during this offline phase.

Add responses expose only safe outcome metadata. Tracking JSON is bounded but
untrusted server-side evidence: it can contain personal information, must not be
logged/rendered directly, and requires sanitization/access controls before future
persistence or UI exposure. No response fields imply delivery or return status.

Persistence, stable tracking allocation, approval/payment checks, attempts,
reconciliation, dispatch authorization, stock protection and safe observation
storage remain future work. A snapshot's TypeScript name is not proof of approval.
No live-order route calls this client.
