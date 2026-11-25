<script lang="ts">
  import { page } from '$app/state';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { labelIn } from '#lib/posts.ts';
  import PostsNav from '../posts-nav.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>{m.posts_authors()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold">{m.nav_posts()}</h1>
  <a href="/posts/authors/new" class={buttonVariants({ size: 'sm' })}>
    <PlusIcon class="size-4" />
    {m.posts_author_new()}
  </a>
</div>
<PostsNav current="/posts/authors" />

{#if page.url.searchParams.has('deleted')}
  <Alert.Root class="mb-4 max-w-3xl" role="status">
    <Alert.Description>{m.posts_author_deleted()}</Alert.Description>
  </Alert.Root>
{/if}

<p class="text-muted-foreground mb-4 text-sm">{m.posts_authors_intro()}</p>

{#if data.authors.length === 0}
  <p class="text-muted-foreground text-sm">{m.posts_authors_none()}</p>
{:else}
  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.posts_author_name()}</Table.Head>
          <Table.Head>{m.pages_slug()}</Table.Head>
          <Table.Head>{m.pages_languages()}</Table.Head>
          <Table.Head>{m.posts_author_account()}</Table.Head>
          <Table.Head>{m.posts_author_page()}</Table.Head>
          <Table.Head class="text-end">{m.posts_post_count()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.authors as author (author.id)}
          <Table.Row>
            <Table.Cell>
              <a href="/posts/authors/{author.id}" class="font-medium hover:underline">
                {labelIn(author.names, data.primary, data.primary)}
              </a>
              {#if author.primary}
                <span class="bg-muted ms-2 rounded px-2 py-0.5 text-xs">
                  {m.posts_author_primary()}
                </span>
              {/if}
            </Table.Cell>
            <Table.Cell class="font-mono text-xs">
              {author.slugs[data.primary] ?? Object.values(author.slugs)[0] ?? '—'}
            </Table.Cell>
            <Table.Cell>
              <div class="flex flex-wrap gap-1">
                {#each data.languages as language (language.code)}
                  <a
                    href="/posts/authors/{author.id}?locale={encodeURIComponent(language.code)}"
                    class="rounded px-1.5 py-0.5 font-mono text-xs {author.names[language.code]
                      ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                      : 'text-muted-foreground border border-dashed'}"
                  >
                    {language.code}
                  </a>
                {/each}
              </div>
            </Table.Cell>
            <Table.Cell class="text-sm">{author.account ?? '—'}</Table.Cell>
            <Table.Cell class="text-sm">
              {author.publicPage ? m.posts_author_page_public() : m.posts_author_page_hidden()}
            </Table.Cell>
            <Table.Cell class="text-end">{author.posts}</Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
{/if}
