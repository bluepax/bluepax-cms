<script lang="ts">
  import { safeHref } from '#lib/links.ts';

  let { label, url, primary = false }: { label: string; url: string; primary?: boolean } = $props();
  const href = $derived(safeHref(url));
  const external = $derived(href?.startsWith('http') ?? false);
</script>

{#if href}
  <a
    class={['button', primary && 'primary']}
    {href}
    rel={external ? 'noopener noreferrer' : undefined}
  >
    {label}
  </a>
{/if}
