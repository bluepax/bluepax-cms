<script lang="ts">
  import { mediaOf, type BlockContext, type BlockOf } from '#lib/blocks.ts';
  import MediaImage from '../MediaImage.svelte';
  import LinkButton from './LinkButton.svelte';

  // 2 Text and media: rich text (safe HTML from the CMS, `html.body`) next to an image.
  let { block, ctx }: { block: BlockOf<'text-media'>; ctx: BlockContext } = $props();
  const image = $derived(mediaOf(ctx, block.data.image));
</script>

<section class={['block', 'container', 'text-media', image && `image-${block.data.imagePosition}`]}>
  <div class="text">
    {#if block.data.title}<h2>{block.data.title}</h2>{/if}
    <div class="prose">
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html block.html.body ?? ''}
    </div>
    {#if block.data.button}<p>
        <LinkButton label={block.data.button.label} url={block.data.button.url} />
      </p>{/if}
  </div>
  {#if image}
    <MediaImage media={image} locale={ctx.locale} sizes="(min-width: 960px) 50vw, 100vw" />
  {/if}
</section>
