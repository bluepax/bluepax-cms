import { fail } from '@sveltejs/kit';
import { renderSVG } from 'uqr';
import { audit } from '#lib/server/audit.ts';
import { accountFailure, parseLocale } from '#lib/server/forms.ts';
import { field, requireUser, secretField } from '#lib/server/guard.ts';
import { clientIp } from '#lib/server/http.ts';
import {
  beginTotp,
  confirmTotp,
  disableTotp,
  pendingTotpSecret,
  setOwnProfile,
  setPassword,
  verifyUserPassword,
} from '#lib/server/modules/users/accounts.ts';
import { encryptionKey, getDatabase } from '#lib/server/runtime.ts';
import { totpUri } from '#lib/server/security/totp.ts';
import { setLocaleCookie } from '#lib/server/session-cookie.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  const user = requireUser(locals);
  const pending = user.totpEnabled
    ? null
    : await pendingTotpSecret(getDatabase(), user.id, encryptionKey());
  return {
    profile: { displayName: user.displayName, email: user.email, locale: user.locale },
    totpEnabled: user.totpEnabled,
    totpSetup: pending
      ? { secret: pending, qr: renderSVG(totpUri(pending, user.email), { border: 1 }) }
      : null,
  };
};

export const actions: Actions = {
  profile: async (event) => {
    const user = requireUser(event.locals);
    const form = await event.request.formData();
    const locale = parseLocale(field(form, 'locale'));
    await setOwnProfile(getDatabase(), user.id, {
      displayName: field(form, 'displayName'),
      locale,
    });
    setLocaleCookie(event.cookies, locale);
    return { saved: 'profile' };
  },

  password: async (event) => {
    const user = requireUser(event.locals);
    const form = await event.request.formData();
    const db = getDatabase();
    if (!(await verifyUserPassword(db, user.id, secretField(form, 'current')))) {
      return fail(400, { error: 'wrong_password', section: 'password' });
    }
    try {
      // Every other session ends; this one stays logged in.
      await setPassword(
        db,
        user.id,
        secretField(form, 'next'),
        event.locals.sessionId ?? undefined,
      );
    } catch (error) {
      return accountFailure(error, { section: 'password' });
    }
    await audit(db, { action: 'account.password_change', actorId: user.id, ip: clientIp(event) });
    return { saved: 'password' };
  },

  totpBegin: async ({ locals }) => {
    const user = requireUser(locals);
    if (!user.totpEnabled) await beginTotp(getDatabase(), user.id, encryptionKey());
    return {};
  },

  totpConfirm: async (event) => {
    const user = requireUser(event.locals);
    const form = await event.request.formData();
    const db = getDatabase();
    try {
      await confirmTotp(db, user.id, field(form, 'code'), encryptionKey(), new Date());
    } catch (error) {
      return accountFailure(error, { section: 'totp' });
    }
    await audit(db, { action: 'account.totp_enable', actorId: user.id, ip: clientIp(event) });
    return { saved: 'totp_on' };
  },

  totpDisable: async (event) => {
    const user = requireUser(event.locals);
    const form = await event.request.formData();
    const db = getDatabase();
    if (!(await verifyUserPassword(db, user.id, secretField(form, 'password')))) {
      return fail(400, { error: 'wrong_password', section: 'totp' });
    }
    await disableTotp(db, user.id);
    await audit(db, { action: 'account.totp_disable', actorId: user.id, ip: clientIp(event) });
    return { saved: 'totp_off' };
  },
};
