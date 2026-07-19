import { pbkdf2Sync, randomBytes } from "node:crypto";

const passphrase = process.env.OWNER_PASSPHRASE ?? "";
if (passphrase.length < 12 || passphrase.length > 128) {
  console.error("OWNER_PASSPHRASE must contain 12 to 128 characters.");
  process.exit(1);
}

const iterations = 600_000;
const salt = randomBytes(16);
const digest = pbkdf2Sync(passphrase, salt, iterations, 32, "sha256");
const sessionSecret = randomBytes(32);

console.log(
  `OWNER_PASSWORD_HASH=pbkdf2-sha256.${iterations}.${salt.toString("base64url")}.${digest.toString("base64url")}`,
);
console.log(`SESSION_SECRET=${sessionSecret.toString("base64url")}`);
