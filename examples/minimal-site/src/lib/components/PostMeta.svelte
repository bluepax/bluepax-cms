<script lang="ts">
  import type { PostSummary, Site } from '@bluepax/cms-client';
  import { formatDate } from '#lib/format.ts';
  import { messages } from '#lib/i18n.ts';

  let { post, site }: { post: PostSummary; site: Site } = $props();
  const t = $derived(messages(post.locale));
  const date = (iso: string) => formatDate(iso, post.locale, site.timezone);
  // Only worth showing when the content changed on a later day.
  const updated = $derived(
    post.modifiedAt && (!post.publishedAt || date(post.modifiedAt) !== date(post.publishedAt))
      ? post.modifiedAt
      : null,
  );
</script>

<p class="meta">
  {#if post.publishedAt}
    <span>
      {t.publishedOn}
      <time datetime={post.publishedAt}>{date(post.publishedAt)}</time>
    </span>
  {/if}
  {#if updated}
    <span>
      {t.updatedOn}
      <time datetime={updated}>{date(updated)}</time>
    </span>
  {/if}
  {#if post.authors.length > 0}
    <span>
      {t.by}
      {#each post.authors as author, i (author.id)}
        {#if i > 0},
        {/if}
        {#if author.path}<a href={author.path} rel="author">
            {author.name}
          </a>{:else}{author.name}{/if}
      {/each}
    </span>
  {/if}
</p>
