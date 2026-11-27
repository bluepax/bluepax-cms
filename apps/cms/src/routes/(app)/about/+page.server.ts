import type { PageServerLoad } from './$types';

// Version, build number, build time and commit (chapter 11), the same as GET /api/health.
export const load: PageServerLoad = () => {
  const { version, build, builtAt, commit } = __BLUEPAX_BUILD_INFO__;
  return { version, build, builtAt, commit };
};
