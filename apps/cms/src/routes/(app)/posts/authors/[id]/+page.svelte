<script lang="ts">
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { labelIn, postErrorText, type PostFormResult } from '#lib/posts.ts';
  import PostsNav from '../../posts-nav.svelte';
  import AuthorForm from './author-form.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const result = $derived(form as PostFormResult | null);
  const dir = $derived(data.languages.find((l) => l.code === data.locale)?.dir ?? 'ltr');
  const names = $derived(
    Object.fromEntries(data.author.translations.map((t) => [t.locale, t.name])),
  );
  const heading = $derived(labelIn(names, data.locale, data.primary));
  const has = (code: string) => data.author.translations.some((t) => t.locale === code);
  const otherSlug = $derived(
    data.author.translations.find((t) => t.locale === data.primary)?.slug ??
      data.author.translations[0]?.slug ??
      '',
  );
</script>

<svelte:head>
  <title>{heading} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">{m.nav_posts()}</h1>
<PostsNav current="/posts/authors" />

<div class="mb-4">
  <a href="/posts/authors" class="text-muted-foreground text-sm hover:underline">
    ← {m.posts_authors()}
  </a>
  <h2 class="mt-2 flex items-center gap-2 text-xl font-semibold">
    <span {dir}>{heading}</span>
    {#if data.author.primary}
      <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">
        {m.posts_author_primary()}
      </span>
    {/if}
  </h2>
  <p class="text-muted-foreground text-sm">
    {m.posts_post_count_text({ count: data.author.posts })}
  </p>
</div>

<nav class="mb-6 flex flex-wrap gap-1 border-b" aria-label={m.pages_languages()}>
  {#each data.languages as language (language.code)}
    <a
      href="?locale={encodeURIComponent(language.code)}"
      class="-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm {data.locale ===
      language.code
        ? 'border-primary font-medium'
        : 'text-muted-foreground border-transparent'}"
      aria-current={data.locale === language.code ? 'page' : undefined}
    >
      <span class="font-mono">{language.code}</span>
      {#if !has(language.code)}
        <span class="text-muted-foreground rounded border border-dashed px-1.5 py-0.5 text-xs">
          {m.pages_status_missing()}
        </span>
      {/if}
    </a>
  {/each}
</nav>

{#if result?.error}
  <Alert.Root variant="destructive" class="mb-6" role="alert">
    <Alert.Title>{postErrorText(result.error, result.details)}</Alert.Title>
  </Alert.Root>
{:else if result?.saved === 'save'}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>
      {result.created ? m.posts_translation_added() : m.saved()}
    </Alert.Description>
  </Alert.Root>
{/if}

{#key `${data.locale}:${new Date(data.author.updatedAt).getTime()}`}
  <AuthorForm
    author={data.author}
    translation={data.translation}
    locale={data.locale}
    {dir}
    {otherSlug}
    media={data.media}
    accounts={data.accounts}
    frontendBaseUrl={data.frontendBaseUrl}
    routes={data.routes}
    {form}
  />
{/key}
