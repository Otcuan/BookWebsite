import { requiredEnv } from "@/lib/runtime";

export const OWNER_COOKIE_NAME = "__Host-library_owner";
export const OWNER_SESSION_SECONDS = 8 * 60 * 60;
const PASSWORD_ITERATIONS = 600_000;

type SessionPayload = {
  role: "owner";
  iat: number;
  exp: number;
  nonce: string;
};

export async function verifyOwnerPassphrase(passphrase: string): Promise<boolean> {
  if (passphrase.length < 1 || passphrase.length > 256) return false;
  const encoded = requiredEnv("OWNER_PASSWORD_HASH");
  const [algorithm, iterationsText, saltText, expectedText, extra] = encoded.split(".");
  const iterations = Number(iterationsText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    iterations !== PASSWORD_ITERATIONS ||
    !saltText ||
    !expectedText ||
    extra
  ) {
    throw new Error("OWNER_PASSWORD_HASH has an unsupported format.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const actual = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: fromBase64Url(saltText),
        iterations,
      },
      key,
      256,
    ),
  );
  return constantTimeEqual(actual, fromBase64Url(expectedText));
}

export async function createOwnerSession(now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    role: "owner",
    iat: issuedAt,
    exp: issuedAt + OWNER_SESSION_SECONDS,
    nonce: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await sign(body)}`;
}

export async function verifyOwnerSession(token: string, now = Date.now()): Promise<boolean> {
  if (token.length > 2048) return false;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return false;
  const expected = await sign(body);
  if (!constantTimeEqual(fromBase64Url(signature), fromBase64Url(expected))) return false;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(body)),
    ) as Partial<SessionPayload>;
    const current = Math.floor(now / 1000);
    return (
      payload.role === "owner" &&
      typeof payload.iat === "number" &&
      typeof payload.exp === "number" &&
      typeof payload.nonce === "string" &&
      payload.iat <= current + 60 &&
      payload.exp > current &&
      payload.exp - payload.iat <= OWNER_SESSION_SECONDS
    );
  } catch {
    return false;
  }
}

async function sign(value: string): Promise<string> {
  const secret = fromBase64Url(requiredEnv("SESSION_SECRET"));
  if (secret.byteLength < 32) throw new Error("SESSION_SECRET must contain at least 32 bytes.");
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return toBase64Url(new Uint8Array(signature));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function toBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(Buffer.from(value, "base64url"));
  } catch {
    return new Uint8Array();
  }
}
