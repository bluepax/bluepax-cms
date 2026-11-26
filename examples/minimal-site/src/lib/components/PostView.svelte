<script lang="ts">
  import type { Post, Site } from '@bluepax/cms-client';
  import { messages } from '#lib/i18n.ts';
  import MediaImage from './MediaImage.svelte';
  import PostMeta from './PostMeta.svelte';

  let { post, site }: { post: Post; site: Site } = $props();
  const t = $derived(messages(post.locale));
</script>

<article class="container narrow post">
  <header>
    {#if post.categories[0]}
      <p class="eyebrow"><a href={post.categories[0].path}>{post.categories[0].name}</a></p>
    {/if}
    <h1>{post.title}</h1>
    <PostMeta {post} {site} />
  </header>
  {#if post.cover}
    <MediaImage
      media={post.cover}
      locale={post.locale}
      class="cover"
      sizes="(min-width: 800px) 760px, 100vw"
      eager
    />
  {/if}
  {#if post.keyTakeaways.length > 0}
    <aside class="takeaways">
      <h2>{t.keyTakeaways}</h2>
      <ul>
        {#each post.keyTakeaways as point, i (i)}<li>{point}</li>{/each}
      </ul>
    </aside>
  {/if}
  <!-- Safe HTML written by the CMS from the rich text JSON (bodyHtml). -->
  <div class="prose">
    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
    {@html post.bodyHtml}
  </div>
  {#if post.tags.length > 0}
    <footer class="tags">
      <span>{t.tags}:</span>
      {#each post.tags as tag (tag.id)}<a href={tag.path} rel="tag">{tag.name}</a>{/each}
    </footer>
  {/if}
</article>
