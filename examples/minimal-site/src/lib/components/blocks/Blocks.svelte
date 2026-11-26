<script lang="ts">
  import { knownBlock, type DeliveredBlock } from '@bluepax/cms-client';
  import type { BlockContext } from '#lib/blocks.ts';
  import Cards from './Cards.svelte';
  import ContactCta from './ContactCta.svelte';
  import Hero from './Hero.svelte';
  import Logos from './Logos.svelte';
  import PendingBlock from './PendingBlock.svelte';
  import PostsBlock from './PostsBlock.svelte';
  import RichText from './RichText.svelte';
  import Stats from './Stats.svelte';
  import Steps from './Steps.svelte';
  import TextMedia from './TextMedia.svelte';

  // The 13 standard blocks (chapter 4). Unknown types are skipped; the load logs them.
  let { blocks, ctx }: { blocks: DeliveredBlock[]; ctx: BlockContext } = $props();
</script>

{#each blocks as raw (raw.id)}
  {@const block = knownBlock(raw)}
  {#if block?.type === 'hero'}
    <Hero {block} {ctx} />
  {:else if block?.type === 'text-media'}
    <TextMedia {block} {ctx} />
  {:else if block?.type === 'cards'}
    <Cards {block} {ctx} />
  {:else if block?.type === 'steps'}
    <Steps {block} />
  {:else if block?.type === 'stats'}
    <Stats {block} />
  {:else if block?.type === 'logos'}
    <Logos {block} {ctx} />
  {:else if block?.type === 'featured-posts' || block?.type === 'latest-posts'}
    <PostsBlock {block} {ctx} />
  {:else if block?.type === 'contact-cta'}
    <ContactCta {block} {ctx} />
  {:else if block?.type === 'rich-text'}
    <RichText {block} />
  {:else if block?.type === 'category-entry' || block?.type === 'catalog-list' || block?.type === 'service-network'}
    <PendingBlock {block} />
  {/if}
{/each}
