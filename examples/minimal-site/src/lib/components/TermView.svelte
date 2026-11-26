<script lang="ts">
  import type { PostList as Posts, Site, Term } from '@bluepax/cms-client';
  import PostList from './PostList.svelte';

  // A post category or tag page.
  let { term, posts, site }: { term: Term; posts: Posts; site: Site } = $props();
</script>

<section class="container">
  <header class="page-header">
    <h1>{term.name}</h1>
    {#if term.description}<p class="lead">{term.description}</p>{/if}
  </header>
  <PostList {posts} {site} />
</section>
