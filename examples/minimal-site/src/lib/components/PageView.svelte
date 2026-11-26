<script lang="ts">
  import type { Page, Site } from '@bluepax/cms-client';
  import Blocks from './blocks/Blocks.svelte';

  let { page, site }: { page: Page; site: Site } = $props();
</script>

<article class="page">
  {#if page.isHome}
    <h1 class="visually-hidden">{page.title || site.name}</h1>
  {:else}
    <header class="container page-header"><h1>{page.title}</h1></header>
  {/if}
  <Blocks blocks={page.blocks} ctx={{ media: page.media, site, locale: page.locale }} />
</article>
