<script lang="ts">
  import { page } from '$app/state';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { statusClass, statusText } from '#lib/pages.ts';
  import { labelIn } from '#lib/posts.ts';
  import { formatDate, selectClass } from '#lib/ui.ts';
  import PostsNav from './posts-nav.svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const lastPage = $derived(Math.max(Math.ceil(data.list.total / data.list.pageSize), 1));
  const pageHref = (n: number) =>
    `/posts?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(n) })}`;
  const editHref = (id: string, locale: string) =>
    `/posts/${id}?locale=${encodeURIComponent(locale)}`;
  const dirOf = (code: string) => data.languages.find((l) => l.code === code)?.dir ?? 'ltr';
  const categoryName = (id: string) => {
    const category = data.categories.find((c) => c.id === id);
    return category ? labelIn(category.names, data.filter.locale, data.primary) : '—';
  };
</script>

<svelte:head>
  <title>{m.nav_posts()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold">{m.nav_posts()}</h1>
  <a
    href="/posts/new?locale={encodeURIComponent(data.filter.locale)}"
    class={buttonVariants({ size: 'sm' })}
  >
    <PlusIcon class="size-4" />
    {m.posts_new()}
  </a>
</div>

<PostsNav current="/posts" />

{#if page.url.searchParams.has('deleted')}
  <Alert.Root class="mb-4 max-w-3xl" role="status">
    <Alert.Description>{m.posts_deleted()}</Alert.Description>
  </Alert.Root>
{/if}

<form method="GET" class="mb-4 flex flex-wrap items-end gap-3" role="search">
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.pages_language()}</span>
    <select name="locale" class="{selectClass} w-40" value={data.filter.locale}>
      {#each data.languages as language (language.code)}
        <option value={language.code}>
          {language.code}{language.code === data.primary ? ` (${m.pages_primary()})` : ''}
        </option>
      {/each}
    </select>
  </label>
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.pages_status()}</span>
    <select name="status" class="{selectClass} w-40" value={data.filter.status}>
      <option value="">{m.pages_status_all()}</option>
      {#each data.statuses as status (status)}
        <option value={status}>{statusText(status)}</option>
      {/each}
    </select>
  </label>
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.posts_category()}</span>
    <select name="category" class="{selectClass} w-48" value={data.filter.category}>
      <option value="">{m.posts_category_all()}</option>
      {#each data.categories as category (category.id)}
        <option value={category.id}>
          {labelIn(category.names, data.filter.locale, data.primary)}
        </option>
      {/each}
    </select>
  </label>
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.pages_search()}</span>
    <Input type="search" name="q" value={data.filter.query} class="w-56" />
  </label>
  <Button type="submit" variant="outline">{m.pages_filter()}</Button>
</form>

{#if data.list.items.length === 0}
  <p class="text-muted-foreground text-sm">
    {data.filter.status === 'missing' ? m.posts_none_missing() : m.posts_none()}
  </p>
{:else}
  <div class="rounded-md border">
    <Table.Root>
      <Table.Header>
        <Table.Row>
          <Table.Head>{m.pages_title()}</Table.Head>
          <Table.Head>{m.pages_slug()}</Table.Head>
          <Table.Head>{m.pages_status()}</Table.Head>
          <Table.Head>{m.posts_categories()}</Table.Head>
          <Table.Head>{m.pages_languages()}</Table.Head>
          <Table.Head>{m.posts_published_column()}</Table.Head>
          <Table.Head>{m.pages_updated()}</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {#each data.list.items as item (item.id)}
          <Table.Row>
            <Table.Cell class="max-w-80">
              <a
                href={editHref(item.id, data.filter.locale)}
                class="block truncate font-medium hover:underline"
                dir={item.locale ? dirOf(item.locale) : 'auto'}
              >
                {item.title || '—'}
              </a>
            </Table.Cell>
            <Table.Cell class="font-mono text-xs">{item.slug ?? '—'}</Table.Cell>
            <Table.Cell>
              <span class="rounded px-2 py-0.5 text-xs {statusClass(item.status)}">
                {item.status ? statusText(item.status) : m.pages_status_missing()}
              </span>
            </Table.Cell>
            <Table.Cell class="max-w-48 truncate text-xs">
              {item.categoryIds.map(categoryName).join(', ') || '—'}
            </Table.Cell>
            <Table.Cell>
              <div class="flex flex-wrap gap-1">
                {#each data.languages as language (language.code)}
                  {@const version = item.languages.find((l) => l.locale === language.code)}
                  <a
                    href={editHref(item.id, language.code)}
                    class="rounded px-1.5 py-0.5 font-mono text-xs {statusClass(
                      version?.status ?? null,
                    )}"
                    title="{language.code}: {version
                      ? statusText(version.status)
                      : m.pages_status_missing()}"
                  >
                    {language.code}
                  </a>
                {/each}
              </div>
            </Table.Cell>
            <Table.Cell class="text-muted-foreground text-xs">
              {item.publishedAt ? formatDate(item.publishedAt) : '—'}
            </Table.Cell>
            <Table.Cell class="text-muted-foreground text-xs">
              {formatDate(item.updatedAt)}
            </Table.Cell>
          </Table.Row>
        {/each}
      </Table.Body>
    </Table.Root>
  </div>
  {#if lastPage > 1}
    <nav class="mt-4 flex items-center gap-2 text-sm" aria-label={m.pages_pagination()}>
      {#if data.list.page > 1}
        <a href={pageHref(data.list.page - 1)} class="underline">{m.pages_previous()}</a>
      {/if}
      <span>{data.list.page} / {lastPage}</span>
      {#if data.list.page < lastPage}
        <a href={pageHref(data.list.page + 1)} class="underline">{m.pages_next()}</a>
      {/if}
    </nav>
  {/if}
{/if}
