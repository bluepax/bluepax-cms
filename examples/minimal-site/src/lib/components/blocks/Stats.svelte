<script lang="ts">
  import type { BlockOf } from '#lib/blocks.ts';

  // 5 Stats: figures as the editor wrote them (`1200`, `24/7`), with unit and label.
  let { block }: { block: BlockOf<'stats'> } = $props();
</script>

<section class="block container stats">
  <dl class="grid">
    {#each block.data.items as item, i (i)}
      <div>
        <dt>{item.label}</dt>
        <dd>
          <strong>{item.value}</strong>{#if item.unit}<span>{item.unit}</span>{/if}
        </dd>
      </div>
    {/each}
  </dl>
</section>
