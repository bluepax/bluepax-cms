<script lang="ts">
  import { mediaOf, type BlockContext, type BlockOf } from '#lib/blocks.ts';
  import { safeHref } from '#lib/links.ts';
  import MediaImage from '../MediaImage.svelte';

  // 6 Logos: customer or partner logos, optionally linked.
  let { block, ctx }: { block: BlockOf<'logos'>; ctx: BlockContext } = $props();
</script>

<section class="block container logos">
  {#if block.data.title}<h2>{block.data.title}</h2>{/if}
  <ul>
    {#each block.data.logos as logo, i (i)}
      {@const href = safeHref(logo.url)}
      {@const image = mediaOf(ctx, logo.image)}
      <li>
        {#if href}
          <a {href} rel="noopener noreferrer" title={logo.name}>
            {#if image}<MediaImage
                media={image}
                locale={ctx.locale}
                sizes="160px"
              />{:else}{logo.name}{/if}
          </a>
        {:else if image}
          <MediaImage media={image} locale={ctx.locale} sizes="160px" />
        {:else}
          {logo.name}
        {/if}
      </li>
    {/each}
  </ul>
</section>
