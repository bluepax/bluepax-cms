<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { errorText, selectClass } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const errorFor = (section: string) =>
    form && 'section' in form && form.section === section ? errorText(form.error) : null;
  const saved = $derived(form && 'saved' in form ? form.saved : null);
  // Reload after saving the language so the whole page switches.
  const reloadAfterProfile =
    () =>
    async ({ update }: { update: () => Promise<void> }) => {
      await update();
      location.reload();
    };
</script>

<svelte:head>
  <title>{m.account_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-semibold">{m.account_title()}</h1>

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.account_profile()}</Card.Title>
      <Card.Description>{data.profile.email}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/profile" use:enhance={reloadAfterProfile} class="grid gap-4">
        <div class="grid gap-2">
          <Label for="displayName">{m.account_display_name()}</Label>
          <Input id="displayName" name="displayName" value={data.profile.displayName} required />
        </div>
        <div class="grid gap-2">
          <Label for="locale">{m.account_language()}</Label>
          <select id="locale" name="locale" class={selectClass} value={data.profile.locale}>
            <option value="zh">{m.lang_zh()}</option>
            <option value="en">{m.lang_en()}</option>
          </select>
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.account_password()}</Card.Title>
    </Card.Header>
    <Card.Content>
      {#if errorFor('password')}
        <Alert.Root variant="destructive" class="mb-4">
          <Alert.Description>{errorFor('password')}</Alert.Description>
        </Alert.Root>
      {:else if saved === 'password'}
        <Alert.Root class="mb-4">
          <Alert.Description>{m.account_password_changed()}</Alert.Description>
        </Alert.Root>
      {/if}
      <form method="POST" action="?/password" use:enhance class="grid gap-4">
        <div class="grid gap-2">
          <Label for="current">{m.account_current_password()}</Label>
          <Input
            id="current"
            name="current"
            type="password"
            autocomplete="current-password"
            required
          />
        </div>
        <div class="grid gap-2">
          <Label for="next">{m.account_new_password()}</Label>
          <Input
            id="next"
            name="next"
            type="password"
            autocomplete="new-password"
            minlength={12}
            required
          />
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {m.account_totp()}
        <Badge variant={data.totpEnabled ? 'default' : 'secondary'}>
          {data.totpEnabled ? m.account_totp_on() : m.account_totp_off()}
        </Badge>
      </Card.Title>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if errorFor('totp')}
        <Alert.Root variant="destructive">
          <Alert.Description>{errorFor('totp')}</Alert.Description>
        </Alert.Root>
      {:else if saved === 'totp_on'}
        <Alert.Root><Alert.Description>{m.account_totp_enabled()}</Alert.Description></Alert.Root>
      {:else if saved === 'totp_off'}
        <Alert.Root><Alert.Description>{m.account_totp_disabled()}</Alert.Description></Alert.Root>
      {/if}

      {#if data.totpEnabled}
        <form method="POST" action="?/totpDisable" use:enhance class="grid gap-4">
          <div class="grid gap-2">
            <Label for="totp-password">{m.login_password()}</Label>
            <Input
              id="totp-password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <div><Button type="submit" variant="destructive">{m.account_totp_disable()}</Button></div>
        </form>
      {:else if data.totpSetup}
        <p class="text-muted-foreground text-sm">{m.account_totp_scan()}</p>
        <div class="flex flex-wrap items-start gap-6">
          <!-- The QR code is an SVG generated on the server from the otpauth URI. -->
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <div class="size-40 rounded border bg-white p-1">{@html data.totpSetup.qr}</div>
          <div class="grid gap-1 text-sm">
            <span class="text-muted-foreground">{m.account_totp_key()}</span>
            <code class="font-mono break-all">{data.totpSetup.secret}</code>
          </div>
        </div>
        <form method="POST" action="?/totpConfirm" use:enhance class="flex items-end gap-3">
          <div class="grid gap-2">
            <Label for="totp-code">{m.login_totp_code()}</Label>
            <Input
              id="totp-code"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              required
            />
          </div>
          <Button type="submit">{m.account_totp_confirm()}</Button>
        </form>
      {:else}
        <form method="POST" action="?/totpBegin" use:enhance>
          <Button type="submit" variant="outline">{m.account_totp_setup()}</Button>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
