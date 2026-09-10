import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
const options = { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 };
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, options).toString("hex");
  return `scrypt$32768$8$3$${salt}$${hash}`;
}
export function verifyPassword(password: string, encoded: string) {
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts.slice(0, 4).join("$") !== "scrypt$32768$8$3" ||
    !/^[a-f0-9]{32}$/.test(parts[4]) ||
    !/^[a-f0-9]{128}$/.test(parts[5])
  )
    return false;
  const computed = scryptSync(password, parts[4], 64, options);
  return timingSafeEqual(computed, Buffer.from(parts[5], "hex"));
}
export function token() {
  return randomBytes(32).toString("base64url");
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
