# Vercel deployment architecture delta

## Scope and decision

The public Vercel site is readable by anyone who has the URL. Only the owner
can create upload sessions or publish objects. Cloudflare D1 remains the
metadata database and R2 remains the private object store.

```text
Reader browser
  -> Vercel CDN / Next.js
  -> public catalog API
  -> Cloudflare D1 REST API

Reader browser
  -> Vercel content route
  -> short-lived presigned R2 GET URL
  -> private Cloudflare R2 object

Owner browser
  -> passphrase login + signed HttpOnly session
  -> create upload reservation
  -> presigned R2 PUT (browser uploads directly)
  -> finalize endpoint validates R2 metadata/signature prefix
  -> D1 batch publishes book and commits quota
```

## Why the upload is direct to R2

Vercel Functions have a 4.5 MB request/response payload limit, while the book
limit is 50 MiB. A Vercel Function therefore signs a five-minute PUT URL but
does not proxy file bytes. Finalization performs server-side HEAD and prefix
validation before publishing metadata. The bucket stays private.

## Authentication and authorization

- Public readers have no server session and no write permission.
- Reading progress is device-local and contains no authentication secret.
- The owner passphrase is stored only as a PBKDF2-HMAC-SHA256 hash with a unique
  salt and 600,000 iterations.
- A successful login creates a short-lived HMAC-signed `__Host-` cookie with
  `Secure`, `HttpOnly`, `SameSite=Strict`, and `Path=/`.
- Owner write APIs require a valid session and same-origin request.
- Login and upload endpoints use D1-backed rate limits.

## Cloud credentials

Vercel receives only server-side environment variables:

- D1 API token scoped to the selected database with D1 Read and D1 Write.
- R2 S3 access key scoped to the selected bucket.
- Owner password hash and independent 32-byte session secret.

No Cloudflare global API key, R2 secret, session key, or passphrase is exposed
to the browser or committed to Git.

## Storage integrity and strict-free controls

- D1 keeps a 9,000,000,000-byte hard constraint across committed and reserved
  objects.
- Upload reservation happens before the presigned PUT is returned.
- Finalization checks object size, MIME type and PDF/TXT prefix before publish.
- Expired reservations are released and their orphan object key can be deleted.
- Monthly Class A/Class B application circuit breakers remain enabled.
- R2 CORS allows only the production Vercel origin and required GET/PUT/HEAD
  methods.

## Residual risks

- Public-read means a visitor can redistribute a still-valid presigned URL.
- Owner-supplied PDFs are not antivirus-scanned in the strict-free MVP.
- D1 REST adds network latency compared with a Worker binding.
- Provider pricing and free-tier policy can change; application guards reduce
  usage but cannot guarantee a zero invoice outside the configured services.
