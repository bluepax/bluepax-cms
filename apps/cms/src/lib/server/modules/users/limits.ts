import { SlidingWindowLimiter } from '../../security/rate-limit.ts';

/** Login attempts per client IP: 20 per 10 minutes (chapter 13, "限速"). */
export const loginLimiter = new SlidingWindowLimiter(20, 10 * 60 * 1000);
