<script lang="ts">
  import { contentPath, type RouteTemplates } from '@bluepax/presets/routes';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '$app/forms';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import SeoPanel, { type SchemaBase, type SeoState } from '#lib/components/seo-panel.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn } from '#lib/pages.ts';
  import { selectClass, textareaClass } from '#lib/ui.ts';

  // The form of one author language together with the fields shared by all languages (avatar,
  // sameAs, public author page, linked account). Saving a language without a version adds it.
  interface Translation {
    name: string;
    slug: string;
    jobTitle: string;
    bio: string;
    seo: SeoState;
  }
  let {
    author,
    translation,
    locale,
    dir,
    otherSlug,
    media: initialMedia,
    accounts,
    frontendBaseUrl,
    routes,
    form,
  }: {
    author: {
      id: string;
      userId: string | null;
      avatar: string | null;
      sameAs: string[];
      publicPage: boolean;
      posts: number;
      primary: boolean;
      updatedAt: Date;
      translations: unknown[];
    };
    translation: Translation | null;
    locale: string;
    dir: 'ltr' | 'rtl';
    otherSlug: string;
    media: Record<string, PickedMedia>;
    accounts: { id: string; displayName: string; email: string; authorId: string | null }[];
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
  let jobTitle = $state(translation?.jobTitle ?? '');
  // svelte-ignore state_referenced_locally
  let seo = $state(structuredClone(translation?.seo ?? emptySeo));
  // svelte-ignore state_referenced_locally
  let media = $state({ ...initialMedia });
  // svelte-ignore state_referenced_locally
  let publicPage = $state(author.publicPage);

  const invalid = $derived(failedIn(form));
  const act = (action: string) => `?/${action}&locale=${encodeURIComponent(locale)}`;
  const schema = (shown: SchemaBase) => ({
    '@type': 'ProfilePage',
    ...shown,
    mainEntity: {
      '@type': 'Person',
      name,
      ...(jobTitle && { jobTitle }),
      ...(author.sameAs.length > 0 && { sameAs: author.sameAs }),
    },
  });
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
  <input type="hidden" name="version" value={new Date(author.updatedAt).toISOString()} />
  <div class="grid content-start gap-6">
    <section class="grid gap-4">
      {#if !translation}
        <p class="text-muted-foreground text-sm">{m.posts_term_add_language({ locale })}</p>
      {/if}
      <label class="grid gap-1 text-sm">
        <span class="font-medium">{m.posts_author_name()}</span>
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
        <span class="font-medium">{m.posts_author_job_title()}</span>
        <Input
          name="jobTitle"
          {dir}
          lang={locale}
          maxlength={200}
          bind:value={jobTitle}
          aria-invalid={invalid('jobTitle')}
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="font-medium">{m.posts_author_bio()}</span>
        <textarea
          name="bio"
          class="{textareaClass} min-h-28"
          {dir}
          lang={locale}
          maxlength={5000}
          value={translation?.bio ?? ''}
          aria-invalid={invalid('bio')}></textarea>
      </label>
    </section>

    <section class="bg-card grid gap-4 rounded-lg border p-4" aria-labelledby="author-shared">
      <div>
        <h3 id="author-shared" class="text-base font-semibold">{m.posts_shared()}</h3>
        <p class="text-muted-foreground text-xs">{m.posts_author_shared_hint()}</p>
      </div>
      <MediaPicker
        id="author-avatar"
        name="avatar"
        label={m.posts_author_avatar()}
        kind="image"
        value={author.avatar ? (media[author.avatar] ?? null) : null}
        invalid={invalid('avatar')}
        onchange={(item) => {
          if (item) media[item.id] = item;
        }}
      />
      <label class="grid gap-1 text-sm">
        <span class="font-medium">{m.settings_publisher_same_as()}</span>
        <textarea
          name="sameAs"
          class="{textareaClass} min-h-16"
          dir="ltr"
          value={author.sameAs.join('\n')}
          aria-invalid={invalid('sameAs')}></textarea>
        <span class="text-muted-foreground text-xs">{m.posts_author_same_as_hint()}</span>
      </label>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" name="publicPage" bind:checked={publicPage} />
        {m.posts_author_public_page()}
      </label>
      <p class="text-muted-foreground -mt-2 text-xs">{m.posts_author_public_page_hint()}</p>
      <div class="grid gap-2">
        <Label for="author-user">{m.posts_author_account()}</Label>
        <select
          id="author-user"
          name="userId"
          class={selectClass}
          value={author.userId ?? ''}
          aria-invalid={invalid('userId')}
        >
          <option value="">{m.posts_author_account_none()}</option>
          {#each accounts as account (account.id)}
            <option
              value={account.id}
              disabled={account.authorId !== null && account.authorId !== author.id}
            >
              {account.displayName} · {account.email}
            </option>
          {/each}
        </select>
        <p class="text-muted-foreground text-xs">{m.posts_author_account_hint()}</p>
      </div>
    </section>

    <div class="flex flex-wrap gap-2 border-t pt-4">
      <Button type="submit">
        {translation ? m.save() : m.posts_term_add_language_button({ locale })}
      </Button>
      {#if translation && author.translations.length > 1}
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
        data-confirm={m.posts_author_delete_confirm()}
      >
        {m.posts_author_delete()}
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
        path={contentPath('author', locale, slug, routes)}
        {frontendBaseUrl}
        {schema}
        slugNote={publicPage ? '' : m.posts_author_no_page_note()}
        bind:media
        reserved={[]}
        {invalid}
        onchange={() => {}}
      />
    </div>
  </aside>
</form>
