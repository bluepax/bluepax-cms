<script lang="ts">
  import { contentPath, type RouteTemplates } from '@bluepax/presets/routes';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import type { SubmitFunction } from '$app/forms';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import OrderedPicker from '#lib/components/ordered-picker.svelte';
  import RichTextEditor from '#lib/components/rich-text-editor.svelte';
  import SeoPanel, { type SchemaBase, type SeoState } from '#lib/components/seo-panel.svelte';
  import PreviewLink from '#lib/components/preview-link.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn, statusClass, statusText, type Status } from '#lib/pages.ts';
  import { labelIn } from '#lib/posts.ts';
  import { formatDate, textareaClass } from '#lib/ui.ts';

  // The editor of one post language: title, excerpt, body, key takeaways, the fields shared by
  // all languages (cover, categories, tags, authors) and the SEO panel, in one form. The status
  // buttons save the form too, so nothing typed is lost (in M1 edits change the content
  // directly; working copies follow in M2). The shared fields are only sent after they were
  // changed, so saving one language never overwrites another editor's shared changes.
  interface Translation {
    locale: string;
    title: string;
    slug: string;
    excerpt: string;
    body: unknown;
    keyTakeaways: string[];
    status: Status;
    source: string;
    publishedAt: Date | null;
    modifiedAt: Date | null;
    unpublishedAt: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
    seo: SeoState;
  }
  interface Shared {
    id: string;
    cover: string | null;
    categoryIds: string[];
    tagIds: string[];
    authorIds: string[];
    updatedAt: Date;
  }
  type Options = { id: string; names: Record<string, string> }[];

  let {
    post,
    translation,
    media: initialMedia,
    dir,
    primary,
    options,
    reserved,
    frontendBaseUrl,
    routes,
    site,
    can,
    canDeleteTranslation,
    form,
  }: {
    post: Shared;
    translation: Translation;
    media: Record<string, PickedMedia>;
    dir: 'ltr' | 'rtl';
    primary: string;
    options: { categories: Options; tags: Options; authors: Options };
    reserved: string[];
    frontendBaseUrl: string;
    routes: RouteTemplates;
    site: { name: string; publisher: { type: string; name: string } };
    can: { publish: boolean; delete: boolean; taxonomy: boolean; authors: boolean };
    canDeleteTranslation: boolean;
    form: unknown;
  } = $props();

  // Local copies: the parent re-creates this component after every save (keyed by updatedAt).
  // svelte-ignore state_referenced_locally
  const locale = translation.locale;
  // svelte-ignore state_referenced_locally
  let title = $state(translation.title);
  // svelte-ignore state_referenced_locally
  let slug = $state(translation.slug);
  // svelte-ignore state_referenced_locally
  let excerpt = $state(translation.excerpt);
  // svelte-ignore state_referenced_locally
  let body = $state(structuredClone(translation.body));
  // svelte-ignore state_referenced_locally
  let takeaways = $state(translation.keyTakeaways.join('\n'));
  // svelte-ignore state_referenced_locally
  let seo = $state(structuredClone(translation.seo));
  // svelte-ignore state_referenced_locally
  let media = $state({ ...initialMedia });
  // svelte-ignore state_referenced_locally
  let cover = $state(post.cover);
  // svelte-ignore state_referenced_locally
  let categoryIds = $state([...post.categoryIds]);
  // svelte-ignore state_referenced_locally
  let tagIds = $state([...post.tagIds]);
  // svelte-ignore state_referenced_locally
  let authorIds = $state([...post.authorIds]);
  /** The publication date in the browser's time zone, for the datetime-local input. */
  // svelte-ignore state_referenced_locally
  let publishedLocal = $state(localInput(translation.publishedAt));
  let dirty = $state(false);
  let sharedDirty = $state(false);
  /** The date is only sent once changed: the input has no seconds, the stored date has. */
  let dateDirty = $state(false);
  let submitting = $state(false);

  const invalid = $derived(failedIn(form));
  const status = $derived(translation.status);
  const markDirty = () => (dirty = true);
  const markShared = () => {
    dirty = true;
    sharedDirty = true;
  };
  /** Action URL that keeps the language in the address after the form is handled. */
  const act = (name: string) => `?/${name}&locale=${encodeURIComponent(locale)}`;
  const labelled = (list: Options) =>
    list.map((o) => ({ id: o.id, label: labelIn(o.names, locale, primary) }));
  const resolve = (id: string) => media[id]?.thumbUrl ?? null;

  function localInput(value: Date | string | null): string {
    if (!value) return '';
    const date = new Date(value);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  const publishedIso = $derived(publishedLocal ? new Date(publishedLocal).toISOString() : '');

  // Same rule as the route templates (`/{locale}/blog/{slug}`).
  const path = $derived(contentPath('post', locale, slug, routes));
  const schema = (shown: SchemaBase) => ({
    '@type': 'BlogPosting',
    ...shown,
    headline: title,
    ...(translation.publishedAt && {
      datePublished: new Date(translation.publishedAt).toISOString(),
    }),
    ...(translation.modifiedAt && {
      dateModified: new Date(translation.modifiedAt).toISOString(),
    }),
    author: authorIds.map((id) => ({
      '@type': 'Person',
      name: labelIn(options.authors.find((a) => a.id === id)?.names ?? {}, locale, primary),
    })),
    publisher: {
      '@type': site.publisher.type === 'person' ? 'Person' : 'Organization',
      name: site.publisher.name || site.name,
    },
  });

  beforeNavigate((navigation) => {
    if (dirty && !submitting && !confirm(m.pages_unsaved())) navigation.cancel();
  });

  const submit: SubmitFunction = ({ submitter, cancel }) => {
    const message = submitter?.getAttribute('data-confirm');
    if (message && !confirm(message)) {
      cancel();
      return;
    }
    submitting = true;
    return async ({ result, update }) => {
      await update({ reset: false });
      submitting = false;
      if (result.type === 'success' || result.type === 'redirect') dirty = false;
    };
  };
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (dirty && !submitting) event.preventDefault();
  }}
/>

<form
  method="POST"
  action={act('save')}
  use:enhance={submit}
  oninput={markDirty}
  class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]"
>
  <input type="hidden" name="locale" value={locale} />
  <input type="hidden" name="version" value={new Date(translation.updatedAt).toISOString()} />
  <input type="hidden" name="sharedVersion" value={new Date(post.updatedAt).toISOString()} />
  <input type="hidden" name="body" value={JSON.stringify(body)} />
  {#if sharedDirty}
    <input
      type="hidden"
      name="shared"
      value={JSON.stringify({ cover, categoryIds, tagIds, authorIds })}
    />
  {/if}
  {#if can.publish && dateDirty}
    <input type="hidden" name="publishedAt" value={publishedIso} />
  {/if}

  <div class="grid content-start gap-6">
    <div class="bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="rounded px-2 py-0.5 text-xs font-medium {statusClass(status)}">
          {statusText(status)}
        </span>
        {#if translation.source === 'ai'}
          <span class="rounded bg-violet-100 px-2 py-0.5 text-xs text-violet-900">
            {m.posts_source_ai()}
          </span>
        {/if}
        {#if translation.publishedAt}
          <span class="text-muted-foreground text-xs">
            {m.posts_published_on({ time: formatDate(translation.publishedAt) })}
          </span>
        {/if}
        {#if translation.modifiedAt}
          <span class="text-muted-foreground text-xs">
            {m.posts_modified_on({ time: formatDate(translation.modifiedAt) })}
          </span>
        {/if}
        {#if status === 'unpublished' && translation.unpublishedAt}
          <span class="text-muted-foreground text-xs">
            {m.pages_unpublished_at({ time: formatDate(translation.unpublishedAt) })}
          </span>
        {/if}
        <span class="text-muted-foreground text-xs">
          {m.pages_updated_by({
            time: formatDate(translation.updatedAt),
            name: translation.updatedBy ?? '—',
          })}
        </span>
        {#if dirty}<span class="text-xs text-amber-700 dark:text-amber-400">
            {m.pages_unsaved_badge()}
          </span>{/if}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="outline" disabled={submitting}>{m.save()}</Button>
        <PreviewLink type="post" id={post.id} {locale} />
        {#if status === 'draft' || status === 'unpublished'}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            formaction={act('submit')}
            disabled={submitting}
          >
            {m.pages_submit()}
          </Button>
        {/if}
        {#if status === 'in_review'}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            formaction={act('withdraw')}
            disabled={submitting}
          >
            {m.pages_withdraw()}
          </Button>
        {/if}
        {#if can.publish && status !== 'published'}
          <Button type="submit" size="sm" formaction={act('publish')} disabled={submitting}>
            {m.pages_publish()}
          </Button>
        {/if}
        {#if can.publish && status === 'published'}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            formaction={act('unpublish')}
            data-confirm={m.pages_unpublish_confirm()}
            disabled={submitting}
          >
            {m.pages_unpublish()}
          </Button>
        {/if}
      </div>
    </div>
    {#if status === 'published'}
      <p class="text-muted-foreground -mt-4 text-xs">{m.posts_live_hint()}</p>
    {/if}

    <label class="grid gap-1">
      <span class="text-sm font-medium">{m.pages_title()}</span>
      <Input
        name="title"
        {dir}
        lang={locale}
        required
        maxlength={200}
        class="h-11 text-lg"
        bind:value={title}
        aria-invalid={invalid('title')}
      />
    </label>

    <label class="grid gap-1 text-sm">
      <span class="font-medium">{m.posts_excerpt()}</span>
      <textarea
        name="excerpt"
        class={textareaClass}
        {dir}
        lang={locale}
        maxlength={1000}
        bind:value={excerpt}
        aria-invalid={invalid('excerpt')}></textarea>
      <span class="text-muted-foreground text-xs">{m.posts_excerpt_hint()}</span>
    </label>

    <RichTextEditor
      id="post-body"
      label={m.posts_body()}
      {dir}
      lang={locale}
      {resolve}
      value={$state.snapshot(body) as never}
      invalid={invalid('body')}
      onchange={(doc) => {
        body = doc;
        markDirty();
      }}
      onmedia={(item) => (media[item.id] = item)}
    />

    <label class="grid gap-1 text-sm">
      <span class="font-medium">{m.posts_takeaways()}</span>
      <textarea
        name="keyTakeaways"
        class="{textareaClass} min-h-24"
        {dir}
        lang={locale}
        bind:value={takeaways}
        aria-invalid={invalid('keyTakeaways')}></textarea>
      <span class="text-muted-foreground text-xs">{m.posts_takeaways_hint()}</span>
    </label>

    <section class="bg-card grid gap-4 rounded-lg border p-4" aria-labelledby="shared-title">
      <div>
        <h2 id="shared-title" class="text-base font-semibold">{m.posts_shared()}</h2>
        <p class="text-muted-foreground text-xs">{m.posts_shared_hint()}</p>
      </div>
      <MediaPicker
        id="post-cover"
        label={m.posts_cover()}
        hint={m.posts_cover_hint()}
        kind="image"
        value={cover ? (media[cover] ?? null) : null}
        invalid={invalid('cover')}
        onchange={(item) => {
          if (item) media[item.id] = item;
          cover = item?.id ?? null;
          markShared();
        }}
      />
      <div class="grid gap-4 md:grid-cols-2">
        <OrderedPicker
          id="post-categories"
          label={m.posts_categories()}
          hint={m.posts_categories_hint()}
          options={labelled(options.categories)}
          bind:value={categoryIds}
          max={10}
          {dir}
          invalid={invalid('categoryIds')}
          onchange={markShared}
        />
        <OrderedPicker
          id="post-authors"
          label={m.posts_authors()}
          hint={m.posts_authors_hint()}
          options={labelled(options.authors)}
          bind:value={authorIds}
          max={10}
          {dir}
          invalid={invalid('authorIds')}
          onchange={markShared}
        />
      </div>
      <OrderedPicker
        id="post-tags"
        label={m.posts_tags()}
        options={labelled(options.tags)}
        bind:value={tagIds}
        max={50}
        ordered={false}
        {dir}
        invalid={invalid('tagIds')}
        onchange={markShared}
      />
      {#if can.taxonomy || can.authors}
        <p class="text-muted-foreground text-xs">
          {#if can.taxonomy}
            <a href="/posts/categories" class="underline">{m.posts_manage_categories()}</a> ·
            <a href="/posts/tags" class="underline">{m.posts_manage_tags()}</a>
          {/if}
          {#if can.taxonomy && can.authors}·{/if}
          {#if can.authors}
            <a href="/posts/authors" class="underline">{m.posts_manage_authors()}</a>
          {/if}
        </p>
      {/if}
    </section>

    {#if can.publish}
      <label class="grid max-w-xs gap-1 text-sm">
        <span class="font-medium">{m.posts_published_date()}</span>
        <Input
          type="datetime-local"
          bind:value={publishedLocal}
          oninput={() => (dateDirty = true)}
          aria-invalid={invalid('publishedAt')}
        />
        <span class="text-muted-foreground text-xs">{m.posts_published_date_hint()}</span>
      </label>
    {/if}

    {#if can.delete}
      <div class="flex flex-wrap gap-2 border-t pt-4">
        {#if canDeleteTranslation}
          <Button
            type="submit"
            size="sm"
            variant="outline"
            formaction={act('deleteTranslation')}
            formnovalidate
            data-confirm={m.posts_delete_translation_confirm({ locale })}
            disabled={submitting}
          >
            {m.pages_delete_translation({ locale })}
          </Button>
        {/if}
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          formaction={act('deletePost')}
          formnovalidate
          data-confirm={m.posts_delete_confirm()}
          disabled={submitting}
        >
          {m.posts_delete()}
        </Button>
      </div>
    {/if}
  </div>

  <aside class="lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto">
    <div class="bg-card rounded-lg border p-4">
      <h2 class="mb-4 text-base font-semibold">{m.seo_panel()}</h2>
      <SeoPanel
        bind:seo
        bind:slug
        {title}
        {locale}
        {dir}
        {path}
        {frontendBaseUrl}
        {schema}
        bind:media
        {reserved}
        {invalid}
        onchange={markDirty}
      />
    </div>
  </aside>
</form>
