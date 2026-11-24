<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, selectClass } from '#lib/ui.ts';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const smtp = $derived(data.smtp);
  const bad = $derived(failedFields(form, 'smtp'));

  // Keep the saved values in the form, but never keep a password in it.
  let password = $state('');
  let clearPassword = $state(false);
  const submit: SubmitFunction =
    () =>
    async ({ update, result }) => {
      await update({ reset: false });
      if (result.type === 'success') {
        password = '';
        clearPassword = false;
      }
    };
</script>

<svelte:head>
  <title>{m.settings_email()} · {m.app_name()}</title>
</svelte:head>

<Notice {form} texts={{ clear: m.settings_smtp_cleared() }} />

<form method="POST" action="?/save" use:enhance={submit} class="max-w-3xl">
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {m.settings_smtp()}
        {#if smtp}
          <Badge variant="secondary">{m.settings_smtp_on()}</Badge>
        {:else}
          <Badge variant="outline">{m.settings_smtp_off()}</Badge>
        {/if}
      </Card.Title>
      <Card.Description>
        {smtp ? m.settings_smtp_hint() : m.settings_smtp_off_hint()}
      </Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid items-start gap-4 sm:grid-cols-[2fr_1fr]">
        <div class="grid gap-2">
          <Label for="host">{m.settings_smtp_host()}</Label>
          <Input
            id="host"
            name="host"
            placeholder="smtp.example.com"
            value={smtp?.host ?? ''}
            required
            aria-invalid={bad('host')}
          />
        </div>
        <div class="grid gap-2">
          <Label for="port">{m.settings_smtp_port()}</Label>
          <Input
            id="port"
            name="port"
            type="number"
            min="1"
            max="65535"
            value={String(smtp?.port ?? 587)}
            required
            aria-invalid={bad('port')}
          />
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="security">{m.settings_smtp_security()}</Label>
        <select
          id="security"
          name="security"
          class={selectClass}
          value={smtp?.security ?? 'starttls'}
        >
          <option value="starttls">{m.settings_smtp_starttls()}</option>
          <option value="tls">{m.settings_smtp_tls()}</option>
          <option value="none">{m.settings_smtp_none()}</option>
        </select>
      </div>
      <div class="grid items-start gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="username">{m.settings_smtp_username()}</Label>
          <Input
            id="username"
            name="username"
            autocomplete="off"
            value={smtp?.username ?? ''}
            aria-invalid={bad('username')}
          />
        </div>
        <div class="grid gap-2">
          <Label for="password">{m.settings_smtp_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="new-password"
            placeholder={smtp?.hasPassword ? '••••••••' : ''}
            bind:value={password}
          />
          <p class="text-muted-foreground text-xs">
            {smtp?.hasPassword ? m.settings_smtp_password_kept() : m.settings_smtp_password_hint()}
          </p>
          {#if smtp?.hasPassword}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="clearPassword" bind:checked={clearPassword} />
              {m.settings_smtp_password_clear()}
            </label>
          {/if}
        </div>
      </div>
      <div class="grid gap-2">
        <Label for="fromAddress">{m.settings_smtp_from()}</Label>
        <Input
          id="fromAddress"
          name="fromAddress"
          type="email"
          placeholder="noreply@example.com"
          value={smtp?.fromAddress ?? ''}
          required
          aria-invalid={bad('fromAddress')}
        />
        <p class="text-muted-foreground text-xs">{m.settings_smtp_from_hint()}</p>
      </div>
      <div class="flex gap-2">
        <Button type="submit">{m.save()}</Button>
        {#if smtp}
          <Button type="submit" variant="outline" formaction="?/clear" formnovalidate>
            {m.settings_smtp_clear()}
          </Button>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>
</form>
