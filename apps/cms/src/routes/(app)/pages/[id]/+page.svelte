<script lang="ts">
  import { enhance } from '$app/forms';
  import HouseIcon from '@lucide/svelte/icons/house';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import {
    failedIn,
    pageErrorText,
    statusClass,
    statusText,
    type PageFormResult,
  } from '#lib/pages.ts';
  import { keepValues, selectClass } from '#lib/ui.ts';
  import TranslationFields from '#lib/components/translation-fields.svelte';
  import PageEditor from './page-editor.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const result = $derived(form as PageFormResult | null);
  const version = (code: string) => data.page.translations.find((t) => t.locale === code);
  const dir = $derived(data.languages.find((l) => l.code === data.locale)?.dir ?? 'ltr');
  const heading = $derived(
    data.translation?.title ??
      version(data.primary)?.title ??
      data.page.translations[0]?.title ??
      m.nav_pages(),
  );
  const savedText: Record<string, () => string> = {
    save: m.saved,
    submit: m.pages_submitted,
    withdraw: m.pages_withdrawn,
    publish: m.pages_published,
    unpublish: m.pages_unpublished,
    home: m.pages_home_set,
  };
</script>

<svelte:head>
  <title>{heading} · {m.app_name()}</title>
</svelte:head>

<div class="mb-4">
  <a
    href="/pages?locale={encodeURIComponent(data.locale)}"
    class="text-muted-foreground text-sm hover:underline"
  >
    ← {m.nav_pages()}
  </a>
  <h1 class="mt-2 flex items-center gap-2 text-2xl font-semibold">
    {#if data.page.isHome}
      <HouseIcon class="size-5" aria-hidden="true" />
    {/if}
    <span {dir}>{heading}</span>
    {#if data.page.isHome}
      <span class="bg-muted rounded px-2 py-0.5 text-xs font-medium">{m.pages_home()}</span>
    {/if}
  </h1>
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
    <Alert.Title>{pageErrorText(result.error, result.details)}</Alert.Title>
    {#if result.error === 'in_navigation' && result.details?.items?.length}
      <Alert.Description>
        <ul class="list-disc ps-5">
          {#each result.details.items as item (item)}<li>{item}</li>{/each}
        </ul>
        <a href="/settings/navigation" class="underline">{m.settings_navigation()}</a>
      </Alert.Description>
    {:else if result.error === 'invalid' && result.invalid?.some((f) => f.startsWith('blocks.'))}
      <Alert.Description>{m.blocks_invalid_hint()}</Alert.Description>
    {/if}
  </Alert.Root>
{:else if result?.saved && savedText[result.saved]}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>{savedText[result.saved]!()}</Alert.Description>
  </Alert.Root>
{/if}

{#if data.translation}
  {#key `${data.translation.locale}:${new Date(data.translation.updatedAt).getTime()}`}
    <PageEditor
      translation={data.translation}
      media={data.media}
      {dir}
      isHome={data.page.isHome}
      offered={data.blocks}
      templates={data.templates}
      hiddenFeatures={data.hiddenFeatures}
      reserved={data.reserved}
      frontendBaseUrl={data.frontendBaseUrl}
      routes={data.routes}
      site={data.site}
      primary={data.primary}
      postCategories={data.postCategories}
      posts={data.posts}
      can={data.can}
      canDeleteTranslation={data.page.translations.length > 1}
      {form}
    />
  {/key}
{:else}
  <form method="POST" action="?/addTranslation" use:enhance={keepValues} class="max-w-2xl">
    <input type="hidden" name="locale" value={data.locale} />
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.pages_add_translation({ locale: data.locale })}</Card.Title>
        <Card.Description>{m.pages_add_translation_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <TranslationFields
          {dir}
          lang={data.locale}
          reserved={data.reserved}
          invalid={failedIn(form)}
        />
        {#if data.page.translations.length > 0}
          <div class="grid gap-2">
            <Label for="copyFrom">{m.pages_copy_from()}</Label>
            <select id="copyFrom" name="copyFrom" class={selectClass}>
              <option value="">{m.pages_copy_none()}</option>
              {#each data.page.translations as t (t.locale)}
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
