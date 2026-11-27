<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues } from '#lib/ui.ts';
  import Notice from '../../notice.svelte';
  import EntityForm from '../entity-form.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const bad = $derived(failedFields(form, 'create'));
</script>

<svelte:head>
  <title>{m.settings_entity_new()} · {m.app_name()}</title>
</svelte:head>

<a href="/settings/entities" class="text-muted-foreground mb-4 inline-block text-sm">
  ← {m.settings_entities()}
</a>
<Notice {form} />

<form method="POST" use:enhance={keepValues} class="max-w-3xl">
  <Card.Root>
    <Card.Header><Card.Title>{m.settings_entity_new()}</Card.Title></Card.Header>
    <Card.Content class="grid gap-4">
      <EntityForm languages={data.languages} primary={data.primaryLanguage} invalid={bad} />
      <div><Button type="submit">{m.settings_create()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
