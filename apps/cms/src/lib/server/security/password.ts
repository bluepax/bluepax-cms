// Passwords, see docs/spec/README.md chapter 3 ("账号"): Argon2id, at least 12 characters.
import { hash, verify } from '@node-rs/argon2';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

// OWASP baseline for Argon2id: 19 MiB memory, 2 iterations, 1 lane. (@node-rs/argon2 defaults to Argon2id.)
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export type PasswordProblem = 'too_short' | 'too_long';

export function checkPassword(password: string): PasswordProblem | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (length > PASSWORD_MAX_LENGTH) return 'too_long';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Spends the same time as a real check, so unknown accounts cannot be told apart by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('bluepax-dummy-password-for-timing');
  await verifyPassword(await dummyHash, password);
  return false;
}
