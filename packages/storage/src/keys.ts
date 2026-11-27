// Object keys, see docs/spec/README.md chapter 5 ("对象 key"): originals are
// `{yyyy}/{mm}/{hash}.{ext}` and derived files `{yyyy}/{mm}/{hash}/{variant}.{ext}`.
// Local paths and R2 keys are the same string. The hash is the file's SHA-256 (hex), so a new
// file always gets a new key and cached copies never go stale (`immutable`).

const HASH = /^[0-9a-f]{64}$/;
const EXT = /^[a-z0-9]{2,5}$/;
/** Variant names such as `w960`, `og` or `apple-touch`. */
export const VARIANT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const ORIGINAL_KEY = /^(\d{4})\/(\d{2})\/([0-9a-f]{64})\.([a-z0-9]{2,5})$/;
const MEDIA_KEY = /^\d{4}\/\d{2}\/[0-9a-f]{64}(?:\/[a-z0-9][a-z0-9-]{0,31})?\.[a-z0-9]{2,5}$/;

export function originalKey(date: Date, hash: string, ext: string): string {
  if (!HASH.test(hash)) throw new Error(`invalid hash "${hash}"`);
  if (!EXT.test(ext)) throw new Error(`invalid extension "${ext}"`);
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}/${mm}/${hash}.${ext}`;
}

/** Key of a derived file next to its original: same year, month and hash. */
export function variantKey(original: string, variant: string, ext: string): string {
  const match = ORIGINAL_KEY.exec(original);
  if (!match) throw new Error(`"${original}" is not an original key`);
  if (!VARIANT_NAME.test(variant)) throw new Error(`invalid variant name "${variant}"`);
  if (!EXT.test(ext)) throw new Error(`invalid extension "${ext}"`);
  return `${match[1]}/${match[2]}/${match[3]}/${variant}.${ext}`;
}

/** Whether a string has the shape of an original or derived media key. */
export function isMediaKey(key: string): boolean {
  return MEDIA_KEY.test(key);
}
