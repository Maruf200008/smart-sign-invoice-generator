import "server-only";

import { pbkdf2, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { promisify } from "util";

const pbkdf2Async = promisify(pbkdf2);

/** New hashes use this cost; existing hashes keep verifying with the iteration count stored inside them. */
export const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;
const PASSWORD_DIGEST = "sha256";
const MAX_ITERATIONS = 5_000_000;

/** A real hash of a random value, used to spend the same time verifying when the user doesn't exist. */
const DUMMY_HASH = `${PASSWORD_ITERATIONS}:${"0".repeat(32)}:${"0".repeat(64)}`;

export async function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await pbkdf2Async(secret, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH, PASSWORD_DIGEST);

  return `${PASSWORD_ITERATIONS}:${salt}:${hash.toString("hex")}`;
}

export async function verifySecret(secret: string, storedHash: string | null | undefined) {
  const [iterationsValue, salt, hash] = (storedHash || DUMMY_HASH).split(":");
  const iterations = Number(iterationsValue);

  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > MAX_ITERATIONS || !salt || !hash || !/^[0-9a-f]+$/i.test(hash)) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = await pbkdf2Async(secret, salt, iterations, expected.length, PASSWORD_DIGEST);

  return Boolean(storedHash) && expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Cryptographically secure 6-digit one-time code. */
export function generateOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}
