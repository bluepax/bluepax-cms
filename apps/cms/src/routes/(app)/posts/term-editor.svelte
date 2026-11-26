<script lang="ts">
  import type { RouteTemplates } from '@bluepax/presets/routes';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { labelIn, postErrorText, type PostFormResult } from '#lib/posts.ts';
  import type { SeoState } from '#lib/components/seo-panel.svelte';
  import PostsNav from './posts-nav.svelte';
  import TermForm from './term-form.svelte';

  // The editor of a post category or tag: a tab per content language with name, slug,
  // description and the SEO panel. A language without a version shows an empty form; saving it
  // adds the language. Categories also have their order, shared by all languages.
  interface Translation {
    locale: string;
    name: string;
    slug: string;
    description: string;
    seo: SeoState;
  }
  interface Data {
    kind: 'category' | 'tag';
    term: {
      id: string;
      sortOrder: number;
      posts: number;
      updatedAt: Date;
      translations: Translation[];
    };
    locale: string;
    translation: Translation | null;
    media: Record<string, PickedMedia>;
    languages: { code: string; dir: 'ltr' | 'rtl' }[];
    primary: string;
    frontendBaseUrl: string;
    routes: RouteTemplates;
  }
  let { data, form }: { data: Data; form: unknown } = $props();

  const base = $derived(data.kind === 'category' ? '/posts/categories' : '/posts/tags');
  const result = $derived(form as PostFormResult | null);
  const dir = $derived(data.languages.find((l) => l.code === data.locale)?.dir ?? 'ltr');
  const names = $derived(Object.fromEntries(data.term.translations.map((t) => [t.locale, t.name])));
  const heading = $derived(labelIn(names, data.locale, data.primary));
  const has = (code: string) => data.term.translations.some((t) => t.locale === code);
  /** A new language starts from the slug of another one; names are typed per language. */
  const otherSlug = $derived(
    data.term.translations.find((t) => t.locale === data.primary)?.slug ??
      data.term.translations[0]?.slug ??
      '',
  );
</script>

<svelte:head>
  <title>{heading} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">{m.nav_posts()}</h1>
<PostsNav current={base} />

<div class="mb-4">
  <a href={base} class="text-muted-foreground text-sm hover:underline">
    ← {data.kind === 'category' ? m.posts_categories() : m.posts_tags()}
  </a>
  <h2 class="mt-2 text-xl font-semibold"><span {dir}>{heading}</span></h2>
  <p class="text-muted-foreground text-sm">
    {#if data.kind === 'category'}
      <a href="/posts?category={data.term.id}" class="underline">
        {m.posts_post_count_text({ count: data.term.posts })}
      </a>
    {:else}
      {m.posts_post_count_text({ count: data.term.posts })}
    {/if}
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
    {#if result.error === 'in_use' && result.details?.items?.length}
      <Alert.Description>
        <ul class="list-disc ps-5">
          {#each result.details.items as item (item)}<li>{item}</li>{/each}
        </ul>
      </Alert.Description>
    {/if}
  </Alert.Root>
{:else if result?.saved === 'save'}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>
      {result.created ? m.posts_translation_added() : m.saved()}
    </Alert.Description>
  </Alert.Root>
{/if}

{#key `${data.locale}:${new Date(data.term.updatedAt).getTime()}`}
  <TermForm
    kind={data.kind}
    sortOrder={data.term.sortOrder}
    version={new Date(data.term.updatedAt).toISOString()}
    locale={data.locale}
    {dir}
    translation={data.translation}
    {otherSlug}
    canDeleteTranslation={Boolean(data.translation) && data.term.translations.length > 1}
    posts={data.term.posts}
    media={data.media}
    frontendBaseUrl={data.frontendBaseUrl}
    routes={data.routes}
    {form}
  />
{/key}
