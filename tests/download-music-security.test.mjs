import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readerClient = readFileSync("app/books/[id]/reader-client.tsx", "utf8");
const disposition = readFileSync("lib/content-disposition.ts", "utf8");
const repository = readFileSync("lib/library-repository.ts", "utf8");
const dashboard = readFileSync("app/library-dashboard.tsx", "utf8");
const music = readFileSync("app/background-music.tsx", "utf8");
const layout = readFileSync("app/layout.tsx", "utf8");

test("reader download remains private and receives a bounded attachment filename", () => {
  assert.match(readerClient, /fetch\(\s*`\/api\/v1\/books\/\$\{encodeURIComponent\(book\.id\)\}\/content`/);
  assert.match(readerClient, /credentials: "same-origin"/);
  assert.match(readerClient, /await response\.blob\(\)/);
  assert.match(readerClient, /URL\.createObjectURL\(blob\)/);
  assert.match(readerClient, /anchor\.download = safePdfFilename\(book\.title\)/);
  assert.match(readerClient, /slice\(0, 120\)/);
  assert.ok(disposition.includes('.replace(/[\\u0000-\\u001f\\u007f<>:"/\\\\|?*]/g, "-")'));
  assert.match(disposition, /filename\*=UTF-8''/);
  assert.match(disposition, /slice\(0, 120\)/);
});

test("new direct uploads persist attachment metadata using server-generated headers", () => {
  assert.match(repository, /buildAttachmentDisposition\(input\.title, file\.format\)/);
  assert.match(repository, /"Content-Disposition": bookContentDisposition/);
  assert.match(dashboard, /headers: sessionPayload\.data\.bookUploadHeaders/);
  assert.doesNotMatch(dashboard, /headers: \{ "Content-Disposition": data\.get/);
});

test("background music defaults on, persists opt-out and handles autoplay blocking", () => {
  assert.equal(existsSync("public/audio/README.md"), true);
  assert.match(music, /BACKGROUND_MUSIC_URL = "\/audio\/background\.mp3"/);
  assert.match(music, /MUSIC_PREFERENCE_KEY/);
  assert.match(music, /getItem\(MUSIC_PREFERENCE_KEY\) !== "off"/);
  assert.match(music, /void attemptPlayback\(\)/);
  assert.match(music, /preload="metadata"/);
  assert.match(music, /await audio\.play\(\)/);
  assert.match(music, /audio\.pause\(\)/);
  assert.match(music, /writeMusicEnabledPreference\(false\)/);
  assert.match(music, /NotAllowedError/);
  assert.match(music, /Chạm để bật nhạc/);
  assert.doesNotMatch(music, /setInterval/);
  assert.doesNotMatch(music, /autoPlay/);
  assert.match(layout, /<BackgroundMusic \/>/);
});
