import { describe, expect, it } from 'vitest';
import { parseRoles } from './roles.ts';

describe('parseRoles', () => {
  it('defaults to web and worker', () => {
    expect([...parseRoles(undefined)]).toEqual(['web', 'worker']);
  });

  it('accepts a single role with spaces', () => {
    expect([...parseRoles(' worker ')]).toEqual(['worker']);
  });

  it('rejects unknown and empty values', () => {
    expect(() => parseRoles('web,cron')).toThrow(/unknown role "cron"/);
    expect(() => parseRoles(' , ')).toThrow(/at least one role/);
  });
});
