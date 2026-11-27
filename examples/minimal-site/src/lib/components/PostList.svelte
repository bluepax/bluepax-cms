<script lang="ts">
  import type { PostList, Site } from '@bluepax/cms-client';
  import { page as current } from '$app/state';
  import { messages } from '#lib/i18n.ts';
  import PostCard from './PostCard.svelte';

  // A page of `/posts` with links to the previous and next page (`?page=`).
  let { posts, site }: { posts: PostList; site: Site } = $props();

  const t = $derived(messages(site.locale));
  const pages = $derived(Math.max(1, Math.ceil(posts.total / posts.pageSize)));
  const link = (n: number) =>
    n === 1 ? current.url.pathname : `${current.url.pathname}?page=${n}`;
</script>

{#if posts.items.length === 0}
  <p>{t.noPosts}</p>
{:else}
  <div class="grid">
    {#each posts.items as post (post.id)}
      <PostCard {post} {site} />
    {/each}
  </div>
{/if}
{#if pages > 1}
  <nav class="pagination">
    {#if posts.page > 1}<a href={link(posts.page - 1)} rel="prev">{t.previous}</a>{/if}
    <span>{t.pageOf(posts.page, pages)}</span>
    {#if posts.page < pages}<a href={link(posts.page + 1)} rel="next">{t.next}</a>{/if}
  </nav>
{/if}
