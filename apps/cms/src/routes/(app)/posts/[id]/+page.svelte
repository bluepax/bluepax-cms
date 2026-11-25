<script lang="ts">
  import { enhance } from '$app/forms';
  import TranslationFields from '#lib/components/translation-fields.svelte';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn, statusClass, statusText } from '#lib/pages.ts';
  import { postErrorText, type PostFormResult } from '#lib/posts.ts';
  import { keepValues, selectClass } from '#lib/ui.ts';
  import PostEditor from './post-editor.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const result = $derived(form as PostFormResult | null);
  const version = (code: string) => data.post.translations.find((t) => t.locale === code);
  const dir = $derived(data.languages.find((l) => l.code === data.locale)?.dir ?? 'ltr');
  const heading = $derived(
    data.translation?.title ??
      version(data.primary)?.title ??
      data.post.translations[0]?.title ??
      m.nav_posts(),
  );
  const savedText: Record<string, () => string> = {
    save: m.saved,
    submit: m.pages_submitted,
    withdraw: m.pages_withdrawn,
    publish: m.pages_published,
    unpublish: m.pages_unpublished,
  };
</script>

<svelte:head>
  <title>{heading} · {m.app_name()}</title>
</svelte:head>

<div class="mb-4">
  <a
    href="/posts?locale={encodeURIComponent(data.locale)}"
    class="text-muted-foreground text-sm hover:underline"
  >
    ← {m.nav_posts()}
  </a>
  <h1 class="mt-2 text-2xl font-semibold"><span {dir}>{heading}</span></h1>
</div>

<nav class="mb-6 flex flex-wrap gap-1 border-b" aria-label={m.pages_languages()}>
  {#each data.languages as language (language.code)}
    {@const v = version(language.code)}
    <a
      href="?locale={encodeURIComponent(language.code)}"
      class="-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm {data.locale ===
      language.code
        ? 'border-primary font-medium'
        : 'text-muted-foreground border-transparent'}"
      aria-current={data.locale === language.code ? 'page' : undefined}
    >
      <span class="font-mono">{language.code}</span>
      <span class="rounded px-1.5 py-0.5 text-xs {statusClass(v?.status ?? null)}">
        {v ? statusText(v.status) : m.pages_status_missing()}
      </span>
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
{:else if result?.saved && savedText[result.saved]}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>{savedText[result.saved]!()}</Alert.Description>
  </Alert.Root>
{/if}

{#if data.translation}
  {#key `${data.translation.locale}:${new Date(data.translation.updatedAt).getTime()}:${new Date(data.post.updatedAt).getTime()}`}
    <PostEditor
      post={data.post}
      translation={data.translation}
      media={data.media}
      {dir}
      primary={data.primary}
      options={data.options}
      reserved={data.reserved}
      frontendBaseUrl={data.frontendBaseUrl}
      site={data.site}
      can={data.can}
      canDeleteTranslation={data.post.translations.length > 1}
      {form}
    />
  {/key}
{:else}
  <form method="POST" action="?/addTranslation" use:enhance={keepValues} class="max-w-2xl">
    <input type="hidden" name="locale" value={data.locale} />
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.pages_add_translation({ locale: data.locale })}</Card.Title>
        <Card.Description>{m.posts_add_translation_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <TranslationFields
          {dir}
          lang={data.locale}
          reserved={data.reserved}
          invalid={failedIn(form)}
        />
        {#if data.post.translations.length > 0}
          <div class="grid gap-2">
            <Label for="copyFrom">{m.posts_copy_from()}</Label>
            <select id="copyFrom" name="copyFrom" class={selectClass}>
              <option value="">{m.pages_copy_none()}</option>
              {#each data.post.translations as t (t.locale)}
                <option value={t.locale}>{t.locale} · {t.title}</option>
              {/each}
            </select>
          </div>
        {/if}
        <div><Button type="submit">{m.pages_create_translation()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
{/if}
