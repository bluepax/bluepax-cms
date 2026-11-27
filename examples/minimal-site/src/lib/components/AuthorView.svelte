<script lang="ts">
  import type { Author, PostList as Posts, Site } from '@bluepax/cms-client';
  import { messages } from '#lib/i18n.ts';
  import { safeHref } from '#lib/links.ts';
  import MediaImage from './MediaImage.svelte';
  import PostList from './PostList.svelte';

  let { author, posts, site }: { author: Author; posts: Posts; site: Site } = $props();
  const t = $derived(messages(author.locale));
</script>

<section class="container">
  <header class="page-header author">
    {#if author.avatar}
      <MediaImage media={author.avatar} locale={author.locale} class="avatar" sizes="120px" eager />
    {/if}
    <div>
      <h1>{author.name}</h1>
      {#if author.jobTitle}<p class="eyebrow">{author.jobTitle}</p>{/if}
      {#if author.bio}<p class="bio">{author.bio}</p>{/if}
      {#if author.sameAs.length > 0}
        <ul class="social">
          {#each author.sameAs as url (url)}
            {@const href = safeHref(url)}
            {#if href}<li>
                <a {href} rel="me noopener noreferrer" target="_blank">{new URL(href).hostname}</a>
              </li>{/if}
          {/each}
        </ul>
      {/if}
    </div>
  </header>
  <h2>{t.posts}</h2>
  <PostList {posts} {site} />
</section>
