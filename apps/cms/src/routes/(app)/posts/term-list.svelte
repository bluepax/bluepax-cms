<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import TranslationFields from '#lib/components/translation-fields.svelte';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn } from '#lib/pages.ts';
  import { labelIn, postErrorText, type PostFormResult } from '#lib/posts.ts';
  import { keepValues, selectClass } from '#lib/ui.ts';
  import PostsNav from './posts-nav.svelte';

  // The list of post categories or tags, with a form for a new one.
  interface Data {
    kind: 'category' | 'tag';
    list: {
      items: {
        id: string;
        sortOrder: number;
        names: Record<string, string>;
        slugs: Record<string, string>;
        posts: number;
      }[];
      total: number;
    };
    query: string;
    languages: { code: string; dir: 'ltr' | 'rtl' }[];
    primary: string;
    locale: string;
  }
  let { data, form }: { data: Data; form: unknown } = $props();

  const base = $derived(data.kind === 'category' ? '/posts/categories' : '/posts/tags');
  const title = $derived(data.kind === 'category' ? m.posts_categories() : m.posts_tags());
  const result = $derived(form as PostFormResult | null);
  // svelte-ignore state_referenced_locally
  let locale = $state(data.locale);
  const dir = $derived(data.languages.find((l) => l.code === locale)?.dir ?? 'ltr');
  const dirOf = (code: string) => data.languages.find((l) => l.code === code)?.dir ?? 'ltr';
</script>

<svelte:head>
  <title>{title} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">{m.nav_posts()}</h1>
<PostsNav current={base} />

{#if page.url.searchParams.has('deleted')}
  <Alert.Root class="mb-4 max-w-3xl" role="status">
    <Alert.Description>{m.posts_term_deleted()}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
  <div class="grid content-start gap-4">
    <p class="text-muted-foreground text-sm">
      {data.kind === 'category' ? m.posts_categories_intro() : m.posts_tags_intro()}
    </p>
    {#if data.kind === 'tag'}
      <form method="GET" class="flex items-end gap-2" role="search">
        <label class="grid gap-1 text-sm">
          <span class="font-medium">{m.pages_search()}</span>
          <Input type="search" name="q" value={data.query} class="w-56" />
        </label>
        <Button type="submit" variant="outline">{m.pages_filter()}</Button>
      </form>
    {/if}
    {#if data.list.items.length === 0}
      <p class="text-muted-foreground text-sm">{m.posts_terms_none()}</p>
    {:else}
      <div class="rounded-md border">
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.posts_name()}</Table.Head>
              <Table.Head>{m.pages_slug()}</Table.Head>
              <Table.Head>{m.pages_languages()}</Table.Head>
              <Table.Head class="text-end">{m.posts_post_count()}</Table.Head>
              {#if data.kind === 'category'}
                <Table.Head class="text-end">{m.settings_sort_order()}</Table.Head>
              {/if}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.list.items as item (item.id)}
              {@const shown = labelIn(item.names, data.primary, data.primary)}
              <Table.Row>
                <Table.Cell>
                  <a
                    href="{base}/{item.id}"
                    class="font-medium hover:underline"
                    dir={dirOf(Object.keys(item.names)[0] ?? data.primary)}
                  >
                    {shown}
                  </a>
                </Table.Cell>
                <Table.Cell class="font-mono text-xs">
                  {item.slugs[data.primary] ?? Object.values(item.slugs)[0] ?? '—'}
                </Table.Cell>
                <Table.Cell>
                  <div class="flex flex-wrap gap-1">
                    {#each data.languages as language (language.code)}
                      <a
                        href="{base}/{item.id}?locale={encodeURIComponent(language.code)}"
                        class="rounded px-1.5 py-0.5 font-mono text-xs {item.names[language.code]
                          ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'text-muted-foreground border border-dashed'}"
                        title={item.names[language.code] ?? m.pages_status_missing()}
                      >
                        {language.code}
                      </a>
                    {/each}
                  </div>
                </Table.Cell>
                <Table.Cell class="text-end">
                  {#if data.kind === 'category'}
                    <a href="/posts?category={item.id}" class="hover:underline">{item.posts}</a>
                  {:else}
                    {item.posts}
                  {/if}
                </Table.Cell>
                {#if data.kind === 'category'}
                  <Table.Cell class="text-muted-foreground text-end font-mono text-xs">
                    {item.sortOrder}
                  </Table.Cell>
                {/if}
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {/if}
  </div>

  <form method="POST" action="?/create" use:enhance={keepValues} class="content-start">
    <Card.Root>
      <Card.Header>
        <Card.Title>
          {data.kind === 'category' ? m.posts_category_new() : m.posts_tag_new()}
        </Card.Title>
        <Card.Description>{m.posts_term_new_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        {#if result?.error}
          <p class="text-destructive text-sm" role="alert">
            {postErrorText(result.error, result.details)}
          </p>
        {/if}
        <div class="grid gap-2">
          <Label for="locale">{m.pages_language()}</Label>
          <select id="locale" name="locale" class={selectClass} bind:value={locale}>
            {#each data.languages as language (language.code)}
              <option value={language.code}>{language.code}</option>
            {/each}
          </select>
        </div>
        <TranslationFields
          {dir}
          lang={locale}
          reserved={[]}
          invalid={failedIn(form)}
          name="name"
          label={m.posts_name()}
        />
        <div><Button type="submit">{m.pages_create()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
</div>
