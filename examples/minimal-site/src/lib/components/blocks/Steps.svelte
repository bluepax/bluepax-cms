<script lang="ts">
  import type { BlockOf } from '#lib/blocks.ts';

  // 4 Steps: a numbered process.
  let { block }: { block: BlockOf<'steps'> } = $props();
</script>

<section class="block container steps">
  {#if block.data.title}<h2>{block.data.title}</h2>{/if}
  <ol>
    {#each block.data.steps as step, i (i)}
      <li>
        {#if step.title}<h3>{step.title}</h3>{/if}
        {#if step.description}<p>{step.description}</p>{/if}
      </li>
    {/each}
  </ol>
</section>
