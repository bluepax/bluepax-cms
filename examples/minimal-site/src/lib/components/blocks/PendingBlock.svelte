<script lang="ts">
  import type { BlockOf } from '#lib/blocks.ts';

  // 7 Category entry, 8 Catalog list (catalog module) and 10 Service network (regions module)
  // show data from endpoints that arrive with those modules in M4 (`/catalog/…`, `/regions`).
  // Until then the block keeps its place on the page and shows nothing.
  let { block }: { block: BlockOf<'category-entry' | 'catalog-list' | 'service-network'> } =
    $props();
</script>

<section class="block pending" data-block={block.type} aria-hidden="true"></section>
