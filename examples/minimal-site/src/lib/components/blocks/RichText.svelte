<script lang="ts">
  import type { BlockOf } from '#lib/blocks.ts';

  // 13 Rich text: safe HTML from the CMS (`html.body`), the only HTML a block brings.
  let { block }: { block: BlockOf<'rich-text'> } = $props();
</script>

<section class="block container narrow rich-text">
  {#if block.data.title}<h2>{block.data.title}</h2>{/if}
  <div class="prose">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html block.html.body ?? ''}
  </div>
</section>
