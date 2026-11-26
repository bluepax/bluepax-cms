<script lang="ts">
  import { mediaOf, type BlockContext, type BlockOf } from '#lib/blocks.ts';
  import { safeHref } from '#lib/links.ts';
  import MediaImage from '../MediaImage.svelte';

  // 3 Cards: 2–4 columns of icon, title, description and an optional link.
  let { block, ctx }: { block: BlockOf<'cards'>; ctx: BlockContext } = $props();
</script>

<section class="block container cards">
  {#if block.data.title}<h2>{block.data.title}</h2>{/if}
  <div class="grid" style:--columns={block.data.columns}>
    {#each block.data.cards as card, i (i)}
      {@const href = safeHref(card.url)}
      <article class="card">
        <MediaImage media={mediaOf(ctx, card.icon)} locale={ctx.locale} class="icon" sizes="64px" />
        {#if card.title}
          <h3>
            {#if href}<a {href}>{card.title}</a>{:else}{card.title}{/if}
          </h3>
        {/if}
        {#if card.description}<p>{card.description}</p>{/if}
      </article>
    {/each}
  </div>
</section>
