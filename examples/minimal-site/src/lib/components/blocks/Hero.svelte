<script lang="ts">
  import { mediaOf, type BlockContext, type BlockOf } from '#lib/blocks.ts';
  import MediaImage from '../MediaImage.svelte';
  import LinkButton from './LinkButton.svelte';

  // 1 Hero: title, subtitle, background image or video, up to two buttons. The spec selector bar
  // (`selector`) needs the catalog module (M4) and is not rendered.
  let { block, ctx }: { block: BlockOf<'hero'>; ctx: BlockContext } = $props();
  const background = $derived(mediaOf(ctx, block.data.background));
</script>

<section class={['block', 'hero', background && 'with-background']}>
  {#if background}
    <MediaImage media={background} locale={ctx.locale} class="hero-background" eager />
  {/if}
  <div class="container hero-content">
    {#if block.data.title}<h2 class="hero-title">{block.data.title}</h2>{/if}
    {#if block.data.subtitle}<p class="lead">{block.data.subtitle}</p>{/if}
    {#if block.data.buttons.length > 0}
      <p class="buttons">
        {#each block.data.buttons as button, i (i)}
          <LinkButton label={button.label} url={button.url} primary={i === 0} />
        {/each}
      </p>
    {/if}
  </div>
</section>
