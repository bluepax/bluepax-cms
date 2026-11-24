<script lang="ts">
  import DownloadIcon from '@lucide/svelte/icons/download';
  import { buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.settings_config()} · {m.app_name()}</title>
</svelte:head>

<Card.Root class="max-w-3xl">
  <Card.Header class="flex flex-row items-start justify-between gap-4">
    <div class="grid gap-1.5">
      <Card.Title>{m.settings_config()}</Card.Title>
      <Card.Description>{m.settings_config_hint()}</Card.Description>
    </div>
    <a
      href="/settings/config/download"
      class={buttonVariants({ size: 'sm' })}
      data-sveltekit-reload
      download
    >
      <DownloadIcon class="size-4" />
      {m.settings_config_download()}
    </a>
  </Card.Header>
  <Card.Content class="grid gap-3">
    <p class="text-muted-foreground text-sm">{m.settings_config_scope()}</p>
    <pre
      class="bg-muted max-h-[32rem] overflow-auto rounded-md p-4 font-mono text-xs leading-relaxed"
      dir="ltr">{data.yaml}</pre>
  </Card.Content>
</Card.Root>
