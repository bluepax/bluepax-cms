<script lang="ts">
  import type { BlockContext, BlockOf } from '#lib/blocks.ts';
  import { messages } from '#lib/i18n.ts';
  import PostCard from '../PostCard.svelte';

  // 9 Featured posts and 11 Latest posts: the CMS picks the posts (`posts`).
  let { block, ctx }: { block: BlockOf<'featured-posts' | 'latest-posts'>; ctx: BlockContext } =
    $props();
  const t = $derived(messages(ctx.locale));
</script>

{#if block.posts && block.posts.length > 0}
  <section class="block container posts-block">
    <h2>{block.type === 'featured-posts' ? t.featuredPosts : t.latestPosts}</h2>
    <div class="grid">
      {#each block.posts as post (post.id)}
        <PostCard {post} site={ctx.site} />
      {/each}
    </div>
  </section>
{/if}
