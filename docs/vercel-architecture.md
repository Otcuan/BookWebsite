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
  -> if no manual cover: local PDF.js worker renders page 1 to WebP/JPEG
  -> create upload reservation
  -> presigned R2 PUT for book + generated/manual cover (browser uploads directly)
  -> finalize endpoint validates both R2 objects' metadata/signature prefix
  -> D1 batch publishes book and commits quota
```

## Why the upload is direct to R2

Vercel Functions have a 4.5 MB request/response payload limit, while the book
limit is 100 MiB for a book plus an optional 3 MiB cover. A Vercel Function
therefore signs five-minute PUT URLs but does not proxy file bytes. Finalization
performs server-side HEAD and prefix validation before publishing metadata. The
bucket stays private.

## Automatic PDF cover decision

The owner browser uses the pinned Mozilla PDF.js distribution and a same-origin
Web Worker to render page one into a bounded canvas. The canvas is re-encoded as
WebP (or JPEG fallback) and sent through the existing cover upload flow. No PDF
bytes pass through Vercel and no executable book HTML is inserted into the DOM.
Annotations and XFA are disabled, CMaps/fonts are served locally, embedded image
and canvas areas are bounded, and the server still verifies image size, MIME and
magic bytes before publish. A manual image takes precedence. Encrypted, malformed
or unusually expensive PDFs fall back to the existing generated artwork without
blocking the book upload.

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
- Finalization checks object size, MIME type and PDF/TXT/JPG/PNG/WebP prefix
  before publish. SVG is denied to remove an active-content/XSS surface.
- The reservation counts book and cover bytes together before issuing either
  signed PUT URL.
- Expired reservations are released and their orphan object key can be deleted.
- Monthly Class A/Class B application circuit breakers remain enabled.
- R2 CORS allows only the production Vercel origin and required GET/PUT/HEAD
  methods.

## Residual risks

- Public-read means a visitor can redistribute a still-valid presigned URL.
- Owner-supplied PDFs are not antivirus-scanned in the strict-free MVP.
- A 100 MiB single PUT is not resumable; an interrupted upload must restart.
- Rendering also reads the PDF in the owner browser, so a near-limit file can be
  memory-intensive on older mobile devices. Desktop administration is preferred.
- Automatic covers apply only to new uploads; existing coverless records are not
  mutated by this release.
- Image validation is signature-based rather than full decoder sandboxing;
  upload remains owner-only and the 3 MiB limit reduces residual risk.
- D1 REST adds network latency compared with a Worker binding.
- Provider pricing and free-tier policy can change; application guards reduce
  usage but cannot guarantee a zero invoice outside the configured services.
