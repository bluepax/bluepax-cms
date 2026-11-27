<script lang="ts">
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatDate } from '#lib/ui.ts';
  import UsersNav from '../users-nav.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.audit_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-semibold">{m.users_title()}</h1>
<UsersNav current="/users/audit" />

{#if data.entries.length === 0}
  <p class="text-muted-foreground text-sm">{m.audit_empty()}</p>
{:else}
  <Table.Root>
    <Table.Header>
      <Table.Row>
        <Table.Head>{m.audit_time()}</Table.Head>
        <Table.Head>{m.audit_actor()}</Table.Head>
        <Table.Head>{m.audit_action()}</Table.Head>
        <Table.Head>{m.audit_target()}</Table.Head>
        <Table.Head>{m.audit_ip()}</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {#each data.entries as entry (entry.id)}
        <Table.Row>
          <Table.Cell class="whitespace-nowrap">{formatDate(entry.at)}</Table.Cell>
          <Table.Cell>{entry.actorName ?? '—'}</Table.Cell>
          <Table.Cell><code>{entry.action}</code></Table.Cell>
          <Table.Cell class="text-muted-foreground">
            {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ''}` : '—'}
          </Table.Cell>
          <Table.Cell class="text-muted-foreground">{entry.ip ?? '—'}</Table.Cell>
        </Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
  {#if data.next}
    <div class="mt-4">
      <Button href="?before={data.next}" variant="outline">{m.audit_more()}</Button>
    </div>
  {/if}
{/if}
