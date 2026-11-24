<script lang="ts">
  import PlusIcon from '@lucide/svelte/icons/plus';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  const text = (values: Record<string, string>) =>
    values[data.primaryLanguage] ?? Object.values(values)[0] ?? '—';
</script>

<svelte:head>
  <title>{m.settings_entities()} · {m.app_name()}</title>
</svelte:head>

{#if data.deleted}
  <Alert.Root class="mb-6 max-w-3xl" role="status">
    <Alert.Description>{m.settings_entity_deleted()}</Alert.Description>
  </Alert.Root>
{/if}

<Card.Root class="max-w-3xl">
  <Card.Header class="flex flex-row items-start justify-between gap-4">
    <div class="grid gap-1.5">
      <Card.Title>{m.settings_entities()}</Card.Title>
      <Card.Description>{m.settings_entities_hint()}</Card.Description>
    </div>
    <a href="/settings/entities/new" class={buttonVariants({ size: 'sm' })}>
      <PlusIcon class="size-4" />
      {m.settings_entity_new()}
    </a>
  </Card.Header>
  <Card.Content>
    {#if data.entities.length === 0}
      <p class="text-muted-foreground text-sm">{m.settings_entities_none()}</p>
    {:else}
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>{m.settings_entity_legal_name()}</Table.Head>
            <Table.Head>{m.settings_entity_role()}</Table.Head>
            <Table.Head>{m.settings_locations()}</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each data.entities as entity (entity.id)}
            <Table.Row>
              <Table.Cell>
                <a href="/settings/entities/{entity.id}" class="font-medium hover:underline">
                  {text(entity.legalName)}
                </a>
              </Table.Cell>
              <Table.Cell>{text(entity.role)}</Table.Cell>
              <Table.Cell>{entity.locations}</Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    {/if}
  </Card.Content>
</Card.Root>
