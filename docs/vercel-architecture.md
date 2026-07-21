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
  -> pinned PDF.js worker requests byte ranges
  -> one bounded canvas for the current page

Reader download
  -> same-origin content route
  -> short-lived presigned R2 GET
  -> bounded 100 MiB browser Blob
  -> sanitized local filename

Background music
  -> same-origin static public/audio/background.mp3
  -> lazy load only after an explicit reader action

Owner browser
  -> passphrase login + signed HttpOnly session
  -> if no manual cover: local PDF.js worker renders page 1 to WebP/JPEG
  -> create upload reservation
  -> presigned R2 PUT for book + generated/manual cover (browser uploads directly)
  -> finalize endpoint validates both R2 objects' metadata/signature prefix
  -> D1 batch publishes book and commits quota

Owner delete
  -> exact-title confirmation + owner session + same-origin + rate limit
  -> tombstone hides the book from public readers
  -> R2 deletes the book and optional cover
  -> D1 batch releases committed quota, deletes metadata and writes audit log
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

## Mobile PDF reader decision

The application does not embed the browser-native PDF viewer in an iframe.
Mobile browser PDF implementations vary and may expose only the first page.
Instead, the client uses the already pinned, same-origin PDF.js worker and
renders one page at a time. Previous/next controls, direct page entry, bounded
zoom, keyboard arrows and horizontal swipe are application-owned behavior.
Reading progress maps the current page to a percentage and remains local to the
reader's device.

The default scale is computed independently for every page from both the live
viewport width and height. This makes portrait, landscape and mixed-orientation
documents fit the frame after resize or device rotation. Fit-width remains an
explicit option because whole-page text can be too small on narrow phones.

PDF.js uses 256 KiB range requests with streaming and automatic prefetch
disabled. R2 implements ranged GetObject, while bucket CORS explicitly permits
the `Range` request header and exposes length/range response headers. Only the
current page canvas exists; stale render tasks are cancelled, device pixel ratio
is capped, and total rendered pixels are bounded. At zoom levels wider than the
viewport, horizontal pan takes precedence over page-swipe navigation.

## Download and background audio decisions

New book PUT requests carry a server-generated `Content-Disposition: attachment`
header with sanitized ASCII and RFC 5987 filenames. For compatibility with old
objects that lack that metadata, the reader download button fetches through the
existing five-minute signed GET route, converts the validated response to a
same-origin Blob, and triggers a local filename. This avoids proxying a 100 MiB
response through a Vercel Function, but requires browser memory roughly equal to
the downloaded file size.

Music is not an R2-backed upload feature. The owner places one reviewed MP3 at
`public/audio/background.mp3` before deployment. It is lazy (`preload=none`),
same-origin under CSP, looped, low-volume and started only by a user gesture.
This avoids autoplay-policy differences, unwanted mobile bandwidth and a new
untrusted-upload surface. Next.js client navigation keeps the root audio element
mounted while moving between the library and reader.

## Authentication and authorization

- Public readers have no server session and no write permission.
- Storage quota is queried and rendered only for an authenticated owner; the
  public catalog API returns a book count but no storage metadata.
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
- R2 CORS allows only the production Vercel origin, required GET/PUT/HEAD methods,
  and the `Range`/`Content-Disposition` headers needed for bounded PDF delivery
  and attachment metadata.

## Residual risks

- Public-read means a visitor can redistribute a still-valid presigned URL.
- Owner-supplied PDFs are not antivirus-scanned in the strict-free MVP.
- A 100 MiB single PUT is not resumable; an interrupted upload must restart.
- Automatic cover generation reads the owner-selected PDF in the owner browser,
  so a near-limit file can be memory-intensive on older devices. Desktop
  administration is preferred. Public reading is range-based and one-page-at-a-time,
  but malformed or unusually structured PDFs can still require extra chunks.
- Whole-page fit is device-independent at the layout level, but final sharpness
  and render time still depend on screen density, available RAM/CPU and PDF
  complexity. Canvas pixels and device scale remain capped to fail safely.
- Blob-based download supports existing objects but temporarily holds the full
  file in browser memory; this is a deliberate compatibility trade-off under the
  100 MiB hard upload limit.
- Automatic covers apply only to new uploads; existing coverless records are not
  mutated by this release.
- Permanent R2 deletion cannot be undone. If R2 or D1 fails mid-flow, the
  tombstoned record remains visible only to the owner for an idempotent retry.
- Image validation is signature-based rather than full decoder sandboxing;
  upload remains owner-only and the 3 MiB limit reduces residual risk.
- D1 REST adds network latency compared with a Worker binding.
- Provider pricing and free-tier policy can change; application guards reduce
  usage but cannot guarantee a zero invoice outside the configured services.
