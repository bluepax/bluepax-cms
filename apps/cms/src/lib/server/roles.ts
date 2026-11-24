// Process roles, see docs/spec/README.md chapter 9: one image, and BLUEPAX_ROLES
// decides whether this process serves the web (admin UI + APIs) and/or runs jobs.

export const ROLES = ['web', 'worker'] as const;
export type Role = (typeof ROLES)[number];

export function parseRoles(value: string | undefined): ReadonlySet<Role> {
  const raw = (value ?? 'web,worker')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (raw.length === 0) throw new Error('BLUEPAX_ROLES must name at least one role');
  for (const role of raw) {
    if (!(ROLES as readonly string[]).includes(role)) {
      throw new Error(
        `BLUEPAX_ROLES contains unknown role "${role}" (allowed: ${ROLES.join(', ')})`,
      );
    }
  }
  return new Set(raw as Role[]);
}
