<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const totp = $derived(Boolean(form?.totp ?? (form?.error ? false : data.totp)));
  const error = $derived.by(() => {
    switch (form?.error) {
      case 'invalid':
        return m.login_invalid();
      case 'locked':
        return m.login_locked({ minutes: form.minutes ?? 15 });
      case 'rate_limited':
        return m.login_rate_limited({ minutes: form.minutes ?? 10 });
      case 'totp_invalid':
        return m.login_totp_invalid();
      case 'totp_expired':
        return m.login_totp_expired();
      default:
        return null;
    }
  });
</script>

<svelte:head>
  <title>{m.login_title()} · {m.app_name()}</title>
</svelte:head>

<main class="bg-muted/40 flex min-h-svh items-center justify-center p-6">
  <Card.Root class="w-full max-w-sm">
    <Card.Header>
      <Card.Title class="text-xl">{m.app_name()}</Card.Title>
      <Card.Description>{totp ? m.login_totp_title() : m.login_title()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if error}
        <Alert.Root variant="destructive" class="mb-4">
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      {/if}

      {#if totp}
        <form method="POST" action="?/totp" use:enhance class="grid gap-4">
          <p class="text-muted-foreground text-sm">{m.login_totp_hint()}</p>
          <div class="grid gap-2">
            <Label for="code">{m.login_totp_code()}</Label>
            <Input
              id="code"
              name="code"
              inputmode="numeric"
              autocomplete="one-time-code"
              pattern="[0-9 ]*"
              required
            />
          </div>
          <Button type="submit" class="w-full">{m.login_totp_submit()}</Button>
        </form>
      {:else}
        <form method="POST" action="?/password" use:enhance class="grid gap-4">
          <div class="grid gap-2">
            <Label for="email">{m.login_email()}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autocomplete="username"
              value={form?.email ?? ''}
              required
            />
          </div>
          <div class="grid gap-2">
            <Label for="password">{m.login_password()}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              required
            />
          </div>
          <Button type="submit" class="w-full">{m.login_submit()}</Button>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</main>
