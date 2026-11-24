<script lang="ts">
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatDate } from '#lib/ui.ts';
  import UsersNav from './users-nav.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.users_title()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-6 flex items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold">{m.users_title()}</h1>
  <Button href="/users/new">{m.users_new()}</Button>
</div>
<UsersNav current="/users" />

<Table.Root>
  <Table.Header>
    <Table.Row>
      <Table.Head>{m.users_name()}</Table.Head>
      <Table.Head>{m.users_email()}</Table.Head>
      <Table.Head>{m.users_role()}</Table.Head>
      <Table.Head>{m.users_status()}</Table.Head>
      <Table.Head>{m.users_totp()}</Table.Head>
      <Table.Head>{m.users_last_login()}</Table.Head>
    </Table.Row>
  </Table.Header>
  <Table.Body>
    {#each data.users as user (user.id)}
      <Table.Row>
        <Table.Cell>
          <a class="font-medium underline-offset-4 hover:underline" href="/users/{user.id}">
            {user.displayName}
          </a>
        </Table.Cell>
        <Table.Cell>{user.email}</Table.Cell>
        <Table.Cell>{user.roleName}</Table.Cell>
        <Table.Cell>
          {#if user.disabledAt}
            <Badge variant="secondary">{m.users_disabled()}</Badge>
          {:else if user.locked}
            <Badge variant="destructive">{m.users_locked()}</Badge>
          {:else}
            <Badge variant="outline">{m.users_active()}</Badge>
          {/if}
        </Table.Cell>
        <Table.Cell>{user.totp ? '✓' : '—'}</Table.Cell>
        <Table.Cell class="text-muted-foreground">{formatDate(user.lastLoginAt)}</Table.Cell>
      </Table.Row>
    {/each}
  </Table.Body>
</Table.Root>
