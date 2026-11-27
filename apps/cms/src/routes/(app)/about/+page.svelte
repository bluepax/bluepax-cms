<script lang="ts">
  import * as Card from '#lib/components/ui/card/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { getLocale } from '#lib/paraglide/runtime.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const rows = $derived([
    [m.about_version(), data.version],
    [m.about_build(), String(data.build)],
    [
      m.about_built_at(),
      new Date(data.builtAt).toLocaleString(getLocale() === 'zh' ? 'zh-CN' : 'en'),
    ],
    [m.about_commit(), data.commit],
  ]);
</script>

<svelte:head>
  <title>{m.about_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-6 text-2xl font-semibold">{m.about_title()}</h1>
<Card.Root class="max-w-xl">
  <Card.Header>
    <Card.Title>{m.app_name()}</Card.Title>
  </Card.Header>
  <Card.Content>
    <dl class="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
      {#each rows as [label, value] (label)}
        <dt class="text-muted-foreground">{label}</dt>
        <dd class="font-mono break-all">{value}</dd>
      {/each}
    </dl>
  </Card.Content>
</Card.Root>
