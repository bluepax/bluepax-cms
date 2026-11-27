<script lang="ts">
  import type { BlockContext, BlockOf } from '#lib/blocks.ts';
  import { imHref } from '#lib/links.ts';
  import LinkButton from './LinkButton.svelte';

  // 12 Contact call to action: text, an optional link and the site's instant messaging button.
  // The inquiry form (`showForm`, `businessType`) needs the inquiries module (M4).
  let { block, ctx }: { block: BlockOf<'contact-cta'>; ctx: BlockContext } = $props();
  const im = $derived(block.data.showIm ? ctx.site.im : null);
  const imLink = $derived(im ? imHref(im) : null);
</script>

<section class="block contact-cta">
  <div class="container">
    {#if block.data.title}<h2>{block.data.title}</h2>{/if}
    {#if block.data.description}<p class="lead">{block.data.description}</p>{/if}
    <p class="buttons">
      {#if block.data.link}<LinkButton
          label={block.data.link.label}
          url={block.data.link.url}
          primary
        />{/if}
      {#if im && imLink}
        <a class="button" href={imLink} rel="noopener noreferrer" target="_blank">
          {im.channel}
          {im.number}
        </a>
      {:else if im}
        <span class="button">{im.channel} {im.number}</span>
      {/if}
    </p>
  </div>
</section>
