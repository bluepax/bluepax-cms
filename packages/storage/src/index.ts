import { createLocalDriver } from './local.ts';

export * from './driver.ts';
export * from './keys.ts';
export * from './local.ts';

/** Built-in drivers by name (chapter 5); `r2` is added in M3. */
export const DRIVERS = { local: createLocalDriver } as const;
export type DriverName = keyof typeof DRIVERS;
