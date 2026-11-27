<script lang="ts">
  import { contentPath, type RouteTemplates } from '@bluepax/presets/routes';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '$app/forms';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import SeoPanel, { type SchemaBase, type SeoState } from '#lib/components/seo-panel.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn } from '#lib/pages.ts';
  import { textareaClass } from '#lib/ui.ts';

  // The form of one language of a category or tag; saving a language without a version adds it.
  let {
    kind,
    sortOrder,
    version,
    locale,
    dir,
    translation,
    otherSlug,
    canDeleteTranslation,
    posts,
    media: initialMedia,
    frontendBaseUrl,
    routes,
    form,
  }: {
    kind: 'category' | 'tag';
    sortOrder: number;
    version: string;
    locale: string;
    dir: 'ltr' | 'rtl';
    translation: { name: string; slug: string; description: string; seo: SeoState } | null;
    /** Slug a new language starts from. */
    otherSlug: string;
    canDeleteTranslation: boolean;
    posts: number;
    media: Record<string, PickedMedia>;
    frontendBaseUrl: string;
    routes: RouteTemplates;
    form: unknown;
  } = $props();

  const emptySeo: SeoState = {
    metaTitle: '',
    metaDescription: '',
    canonical: '',
    robots: { index: true, follow: true },
    ogTitle: '',
    ogDescription: '',
    ogImage: null,
    keywords: [],
    summary: '',
  };
  // Local copies: the parent re-creates this component after every save.
  // svelte-ignore state_referenced_locally
  let name = $state(translation?.name ?? '');
  // svelte-ignore state_referenced_locally
  let slug = $state(translation?.slug ?? otherSlug);
  // svelte-ignore state_referenced_locally
  let seo = $state(structuredClone(translation?.seo ?? emptySeo));
  // svelte-ignore state_referenced_locally
  let media = $state({ ...initialMedia });

  const invalid = $derived(failedIn(form));
  const act = (action: string) => `?/${action}&locale=${encodeURIComponent(locale)}`;
  const schema = (shown: SchemaBase) => ({ '@type': 'CollectionPage', ...shown });
  const submit: SubmitFunction = ({ submitter, cancel }) => {
    const message = submitter?.getAttribute('data-confirm');
    if (message && !confirm(message)) {
      cancel();
      return;
    }
    return async ({ update }) => update({ reset: false });
  };
</script>

<form
  method="POST"
  action={act('save')}
  use:enhance={submit}
  class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
>
  <input type="hidden" name="locale" value={locale} />
  <input type="hidden" name="version" value={version} />
  <div class="grid content-start gap-4">
    {#if !translation}
      <p class="text-muted-foreground text-sm">{m.posts_term_add_language({ locale })}</p>
    {/if}
    <label class="grid gap-1 text-sm">
      <span class="font-medium">{m.posts_name()}</span>
      <Input
        name="name"
        {dir}
        lang={locale}
        required
        maxlength={200}
        bind:value={name}
        aria-invalid={invalid('name')}
      />
    </label>
    <label class="grid gap-1 text-sm">
      <span class="font-medium">{m.posts_description()}</span>
      <textarea
        name="description"
        class={textareaClass}
        {dir}
        lang={locale}
        maxlength={2000}
        value={translation?.description ?? ''}
        aria-invalid={invalid('description')}></textarea>
    </label>
    {#if kind === 'category'}
      <label class="grid max-w-40 gap-1 text-sm">
        <span class="font-medium">{m.settings_sort_order()}</span>
        <Input
          name="sortOrder"
          type="number"
          step="1"
          value={String(sortOrder)}
          aria-invalid={invalid('sortOrder')}
        />
        <span class="text-muted-foreground text-xs">{m.posts_sort_order_hint()}</span>
      </label>
    {/if}
    <div class="flex flex-wrap gap-2 border-t pt-4">
      <Button type="submit">
        {translation ? m.save() : m.posts_term_add_language_button({ locale })}
      </Button>
      {#if canDeleteTranslation}
        <Button
          type="submit"
          variant="outline"
          formaction={act('deleteTranslation')}
          formnovalidate
          data-confirm={m.posts_term_delete_translation_confirm({ locale })}
        >
          {m.pages_delete_translation({ locale })}
        </Button>
      {/if}
      <Button
        type="submit"
        variant="destructive"
        formaction={act('delete')}
        formnovalidate
        data-confirm={kind === 'category'
          ? m.posts_category_delete_confirm()
          : m.posts_tag_delete_confirm({ count: posts })}
      >
        {kind === 'category' ? m.posts_category_delete() : m.posts_tag_delete()}
      </Button>
    </div>
  </div>
  <aside class="lg:sticky lg:top-6 lg:self-start">
    <div class="bg-card rounded-lg border p-4">
      <h2 class="mb-4 text-base font-semibold">{m.seo_panel()}</h2>
      <SeoPanel
        bind:seo
        bind:slug
        title={name}
        {locale}
        {dir}
        path={contentPath(kind === 'category' ? 'postCategory' : 'tag', locale, slug, routes)}
        {frontendBaseUrl}
        {schema}
        bind:media
        reserved={[]}
        {invalid}
        onchange={() => {}}
      />
    </div>
  </aside>
</form>
