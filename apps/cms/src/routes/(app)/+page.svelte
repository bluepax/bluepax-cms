<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.home_title()} · {m.app_name()}</title>
</svelte:head>

<h1 class="text-2xl font-semibold">{m.home_welcome({ name: data.user.displayName })}</h1>
<p class="text-muted-foreground mt-2">{m.home_intro()}</p>
