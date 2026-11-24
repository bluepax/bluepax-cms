<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { errorText, selectClass } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const values = $derived(form?.values);
  const defaultRole = $derived(data.roles.find((r) => r.key === 'editor')?.id ?? data.roles[0]?.id);
</script>

<svelte:head>
  <title>{m.users_new()} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-semibold">{m.users_new()}</h1>

<Card.Root class="max-w-xl">
  <Card.Content class="pt-6">
    {#if form?.error}
      <Alert.Root variant="destructive" class="mb-4">
        <Alert.Description>{errorText(form.error)}</Alert.Description>
      </Alert.Root>
    {/if}
    <form method="POST" use:enhance class="grid gap-4">
      <div class="grid gap-2">
        <Label for="email">{m.users_email()}</Label>
        <Input id="email" name="email" type="email" value={values?.email ?? ''} required />
      </div>
      <div class="grid gap-2">
        <Label for="displayName">{m.users_name()}</Label>
        <Input id="displayName" name="displayName" value={values?.displayName ?? ''} required />
      </div>
      <div class="grid gap-2">
        <Label for="password">{m.users_password()}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autocomplete="new-password"
          minlength={12}
          required
        />
      </div>
      <div class="grid gap-2">
        <Label for="roleId">{m.users_role()}</Label>
        <select id="roleId" name="roleId" class={selectClass} value={values?.roleId ?? defaultRole}>
          {#each data.roles as role (role.id)}
            <option value={role.id}>{role.name}</option>
          {/each}
        </select>
      </div>
      <div class="grid gap-2">
        <Label for="locale">{m.users_language()}</Label>
        <select id="locale" name="locale" class={selectClass} value={values?.locale ?? 'zh'}>
          <option value="zh">{m.lang_zh()}</option>
          <option value="en">{m.lang_en()}</option>
        </select>
      </div>
      <div class="flex gap-2">
        <Button type="submit">{m.users_create()}</Button>
        <Button href="/users" variant="ghost">{m.cancel()}</Button>
      </div>
    </form>
  </Card.Content>
</Card.Root>
