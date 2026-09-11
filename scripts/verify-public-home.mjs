import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Check the actual artifact Railway will serve, including redirect metadata.
// A successful compilation alone does not catch absolute-path route collisions.
const home = new URL("../.next/server/app/index.html", import.meta.url);
const metadata = new URL("../.next/server/app/index.meta", import.meta.url);
const [html, meta] = await Promise.all([
  readFile(home, "utf8"),
  readFile(metadata, "utf8").then(JSON.parse),
]);

assert.equal(meta.status ?? 200, 200, "Public home must return HTTP 200");
assert.ok(!meta.headers?.location, "Public home must not redirect");
assert.ok(html.includes('class="landing"'), "Public home must render the landing page");
assert.ok(!html.includes("NEXT_REDIRECT"), "Public home must not contain a client redirect");
console.log("Public landing page build check passed.");
