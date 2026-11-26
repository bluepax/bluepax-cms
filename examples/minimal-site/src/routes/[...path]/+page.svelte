<script lang="ts">
  import AuthorView from '#lib/components/AuthorView.svelte';
  import PageView from '#lib/components/PageView.svelte';
  import PostView from '#lib/components/PostView.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import TermView from '#lib/components/TermView.svelte';

  let { data } = $props();
  const view = $derived(data.view);
</script>

{#if view.kind === 'page'}
  <Seo seo={view.page.seo} />
  <PageView page={view.page} site={data.site} />
{:else if view.kind === 'post'}
  <Seo seo={view.post.seo} />
  <PostView post={view.post} site={data.site} />
{:else if view.kind === 'author'}
  <Seo seo={view.author.seo} />
  <AuthorView author={view.author} posts={view.posts} site={data.site} />
{:else}
  <Seo seo={view.term.seo} />
  <TermView term={view.term} posts={view.posts} site={data.site} />
{/if}
