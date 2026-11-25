<script lang="ts">
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import type { SubmitFunction } from '$app/forms';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import type { PickedPost } from '#lib/components/post-picker.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn, statusClass, statusText, type Status } from '#lib/pages.ts';
  import { formatDate } from '#lib/ui.ts';
  import SeoPanel, { type SchemaBase, type SeoState } from '#lib/components/seo-panel.svelte';
  import BlockEditor, { type EditedBlock } from './block-editor.svelte';

  // The editor of one language: title, blocks and the SEO panel in one form. The status
  // buttons save the form too, so nothing typed is lost (in M1 edits change the content
  // directly; working copies follow in M2).
  interface Translation {
    locale: string;
    title: string;
    slug: string;
    status: Status;
    publishedAt: Date | null;
    unpublishedAt: Date | null;
    updatedAt: Date;
    updatedBy: string | null;
    seo: SeoState;
    blocks: EditedBlock[];
  }

  let {
    translation,
    media: initialMedia,
    dir,
    isHome,
    offered,
    templates,
    hiddenFeatures,
    reserved,
    frontendBaseUrl,
    site,
    primary,
    postCategories,
    posts: initialPosts,
    can,
    canDeleteTranslation,
    form,
  }: {
    translation: Translation;
    media: Record<string, PickedMedia>;
    dir: 'ltr' | 'rtl';
    isHome: boolean;
    offered: string[];
    templates: Record<string, unknown>;
    hiddenFeatures: Record<string, string[]>;
    reserved: string[];
    frontendBaseUrl: string;
    site: { name: string; publisher: { type: string; name: string } };
    primary: string;
    postCategories: { id: string; names: Record<string, string> }[];
    posts: Record<string, PickedPost>;
    can: { publish: boolean; delete: boolean };
    canDeleteTranslation: boolean;
    form: unknown;
  } = $props();

  // Local copies: the parent re-creates this component after every save (keyed by updatedAt).
  // svelte-ignore state_referenced_locally
  let title = $state(translation.title);
  // svelte-ignore state_referenced_locally
  let slug = $state(translation.slug);
  // svelte-ignore state_referenced_locally
  let seo = $state(structuredClone(translation.seo));
  // svelte-ignore state_referenced_locally
  let blocks = $state(structuredClone(translation.blocks));
  // svelte-ignore state_referenced_locally
  let media = $state({ ...initialMedia });
  // svelte-ignore state_referenced_locally
  let posts = $state({ ...initialPosts });
  let dirty = $state(false);
  let submitting = $state(false);

  const invalid = $derived(failedIn(form));
  const status = $derived(translation.status);
  const markDirty = () => (dirty = true);
  // Same rule as the route templates (`/{locale}` for the home page, `/{locale}/{slug}` else).
  const path = $derived(
    isHome
      ? `/${translation.locale.toLowerCase()}`
      : `/${translation.locale.toLowerCase()}/${slug}`,
  );
  const schema = (shown: SchemaBase) => ({
    '@type': 'WebPage',
    ...shown,
    publisher: {
      '@type': site.publisher.type === 'person' ? 'Person' : 'Organization',
      name: site.publisher.name || site.name,
    },
  });
  /** Action URL that keeps the language in the address after the form is handled. */
  const act = (name: string) => `?/${name}&locale=${encodeURIComponent(translation.locale)}`;

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
  <input type="hidden" name="locale" value={translation.locale} />
  <input type="hidden" name="version" value={new Date(translation.updatedAt).toISOString()} />
  <input type="hidden" name="blocks" value={JSON.stringify($state.snapshot(blocks))} />

  <div class="grid content-start gap-6">
    <div class="bg-card flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div class="flex flex-wrap items-center gap-3 text-sm">
        <span class="rounded px-2 py-0.5 text-xs font-medium {statusClass(status)}">
          {statusText(status)}
        </span>
        {#if translation.publishedAt}
          <span class="text-muted-foreground text-xs">
            {m.pages_published_at({ time: formatDate(translation.publishedAt) })}
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
      <p class="text-muted-foreground -mt-4 text-xs">{m.pages_live_hint()}</p>
    {/if}

    <label class="grid gap-1">
      <span class="text-sm font-medium">{m.pages_title()}</span>
      <Input
        name="title"
        {dir}
        lang={translation.locale}
        required
        maxlength={200}
        class="h-11 text-lg"
        bind:value={title}
        aria-invalid={invalid('title')}
      />
    </label>

    <div class="grid gap-2">
      <h2 class="text-lg font-semibold">{m.blocks_title()}</h2>
      <BlockEditor
        bind:blocks
        bind:media
        bind:posts
        {primary}
        {postCategories}
        {offered}
        {templates}
        {hiddenFeatures}
        {dir}
        lang={translation.locale}
        {invalid}
        onchange={markDirty}
      />
    </div>

    <div class="flex flex-wrap gap-2 border-t pt-4">
      {#if can.publish && !isHome}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          formaction={act('home')}
          formnovalidate
          disabled={submitting}
        >
          {m.pages_make_home()}
        </Button>
      {/if}
      {#if can.delete && canDeleteTranslation}
        <Button
          type="submit"
          size="sm"
          variant="outline"
          formaction={act('deleteTranslation')}
          formnovalidate
          data-confirm={m.pages_delete_translation_confirm({ locale: translation.locale })}
          disabled={submitting}
        >
          {m.pages_delete_translation({ locale: translation.locale })}
        </Button>
      {/if}
      {#if can.delete}
        <Button
          type="submit"
          size="sm"
          variant="destructive"
          formaction={act('deletePage')}
          formnovalidate
          data-confirm={m.pages_delete_confirm()}
          disabled={submitting}
        >
          {m.pages_delete()}
        </Button>
      {/if}
    </div>
  </div>

  <aside class="lg:sticky lg:top-6 lg:max-h-[calc(100svh-3rem)] lg:self-start lg:overflow-y-auto">
    <div class="bg-card rounded-lg border p-4">
      <h2 class="mb-4 text-base font-semibold">{m.seo_panel()}</h2>
      <SeoPanel
        bind:seo
        bind:slug
        {title}
        locale={translation.locale}
        {dir}
        {path}
        {frontendBaseUrl}
        {schema}
        slugNote={isHome
          ? m.pages_slug_home_hint({ locale: translation.locale.toLowerCase() })
          : ''}
        bind:media
        {reserved}
        {invalid}
        onchange={markDirty}
      />
    </div>
  </aside>
</form>
