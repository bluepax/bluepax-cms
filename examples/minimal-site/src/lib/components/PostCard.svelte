<script lang="ts">
  import type { PostSummary, Site } from '@bluepax/cms-client';
  import MediaImage from './MediaImage.svelte';
  import PostMeta from './PostMeta.svelte';

  let { post, site }: { post: PostSummary; site: Site } = $props();
</script>

<article class="card post-card">
  {#if post.cover}
    <a href={post.path} tabindex="-1" aria-hidden="true">
      <MediaImage media={post.cover} locale={post.locale} sizes="(min-width: 960px) 30vw, 100vw" />
    </a>
  {/if}
  <h3><a href={post.path}>{post.title}</a></h3>
  <PostMeta {post} {site} />
  {#if post.excerpt}<p>{post.excerpt}</p>{/if}
</article>
