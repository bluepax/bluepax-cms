<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { errorText } from '#lib/ui.ts';
  import UsersNav from '../users-nav.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const notice = $derived.by(() => {
    if (form?.error) return { error: true, text: errorText(form.error) };
    const saved = form && 'saved' in form ? form.saved : null;
    if (saved === 'create') return { error: false, text: m.roles_created() };
    if (saved === 'delete') return { error: false, text: m.roles_deleted() };
    if (saved === 'update') return { error: false, text: m.saved() };
    return null;
  });
</script>

<svelte:head>
  <title>{m.roles_title()} · {m.app_name()}</title>
</svelte:head>

{#snippet permissionBoxes(selected: string[])}
  {#if data.permissions.length === 0}
    <p class="text-muted-foreground text-sm">{m.roles_none()}</p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2">
      {#each data.permissions as permission (permission.name)}
        <label class="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="permission"
            value={permission.name}
            checked={selected.includes(permission.name)}
          />
          <code>{permission.name}</code>
          <span class="text-muted-foreground text-xs">
            {permission.kind === 'content' ? m.roles_content() : m.roles_settings()}
          </span>
        </label>
      {/each}
    </div>
  {/if}
{/snippet}

<h1 class="mb-6 text-2xl font-semibold">{m.users_title()}</h1>
<UsersNav current="/users/roles" />

{#if notice}
  <Alert.Root variant={notice.error ? 'destructive' : 'default'} class="mb-6 max-w-3xl">
    <Alert.Description>{notice.text}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid max-w-3xl gap-6">
  {#each data.roles as role (role.id)}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2">
          {role.name}
          <code class="text-muted-foreground text-sm font-normal">{role.key}</code>
          {#if role.system}<Badge variant="secondary">{m.roles_system()}</Badge>{/if}
        </Card.Title>
        <Card.Description>{m.roles_users()}: {role.users}</Card.Description>
      </Card.Header>
      <Card.Content>
        <form method="POST" action="?/update" use:enhance class="grid gap-4">
          <input type="hidden" name="id" value={role.id} />
          <div class="grid gap-2">
            <Label for="name-{role.id}">{m.roles_name()}</Label>
            <Input id="name-{role.id}" name="name" value={role.name} required />
          </div>
          <div class="grid gap-2">
            <span class="text-sm font-medium">{m.roles_permissions()}</span>
            {#if role.key === 'admin'}
              <p class="text-muted-foreground text-sm">{m.roles_all()}</p>
            {:else}
              {@render permissionBoxes(role.permissions)}
            {/if}
          </div>
          <div class="flex gap-2">
            <Button type="submit">{m.save()}</Button>
            {#if !role.system}
              <Button type="submit" formaction="?/delete" variant="destructive">
                {m.roles_delete()}
              </Button>
            {/if}
          </div>
        </form>
      </Card.Content>
    </Card.Root>
  {/each}

  <Card.Root>
    <Card.Header><Card.Title>{m.roles_new()}</Card.Title></Card.Header>
    <Card.Content>
      <form method="POST" action="?/create" use:enhance class="grid gap-4">
        <div class="grid gap-2">
          <Label for="new-key">{m.roles_key()}</Label>
          <Input id="new-key" name="key" pattern="[a-z][a-z0-9_-]{'{1,31}'}" required />
        </div>
        <div class="grid gap-2">
          <Label for="new-name">{m.roles_name()}</Label>
          <Input id="new-name" name="name" required />
        </div>
        <div class="grid gap-2">
          <span class="text-sm font-medium">{m.roles_permissions()}</span>
          {@render permissionBoxes([])}
        </div>
        <div><Button type="submit">{m.roles_create()}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
