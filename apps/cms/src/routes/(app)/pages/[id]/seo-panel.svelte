<script lang="ts" module>
  export interface SeoState {
    metaTitle: string;
    metaDescription: string;
    canonical: string;
    robots: { index: boolean; follow: boolean };
    ogTitle: string;
    ogDescription: string;
    ogImage: string | null;
    keywords: string[];
    summary: string;
  }
</script>

<script lang="ts">
  import { slugify } from '@bluepax/core';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { textareaClass } from '#lib/ui.ts';

  // The SEO panel of one language (docs/spec/README.md chapter 3, "SEO 面板"): slug, meta,
  // canonical, robots, OG, target keywords and the one-sentence answer, with a search result
  // preview and a simplified schema.org preview (docs/adr/0009). Fields are named `seo.<field>`.
  let {
    seo = $bindable(),
    slug = $bindable(),
    title,
    locale,
    dir,
    isHome,
    frontendBaseUrl,
    site,
    media = $bindable(),
    reserved,
    invalid,
    onchange,
  }: {
    seo: SeoState;
    slug: string;
    title: string;
    locale: string;
    dir: 'ltr' | 'rtl';
    isHome: boolean;
    frontendBaseUrl: string;
    site: { name: string; publisher: { type: string; name: string } };
    media: Record<string, PickedMedia>;
    reserved: string[];
    invalid: (field: string) => boolean;
    onchange: () => void;
  } = $props();

  const RECOMMENDED = { title: 60, description: 160 };

  // Same rule as the route templates (`/{locale}` for the home page, `/{locale}/{slug}` else).
  const path = $derived(isHome ? `/${locale.toLowerCase()}` : `/${locale.toLowerCase()}/${slug}`);
  const address = $derived(seo.canonical || `${frontendBaseUrl}${path}`);
  const shownTitle = $derived(seo.metaTitle || title);
  const shownDescription = $derived(seo.metaDescription || seo.summary);
  // The textarea keeps what is typed (including a trailing new line); the list follows it.
  let keywordText = $state(seo.keywords.join('\n'));

  const schemaPreview = $derived(
    JSON.stringify(
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: shownTitle,
        ...(shownDescription && { description: shownDescription }),
        url: address,
        inLanguage: locale,
        ...(seo.keywords.length > 0 && { keywords: seo.keywords.join(', ') }),
        publisher: {
          '@type': site.publisher.type === 'person' ? 'Person' : 'Organization',
          name: site.publisher.name || site.name,
        },
      },
      null,
      2,
    ),
  );

  const counter = (value: string, max: number) =>
    `${value.length} / ${max}${value.length > max ? ` · ${m.seo_too_long()}` : ''}`;
</script>

<div class="grid gap-4">
  <div class="grid gap-1 text-sm">
    <label for="seo-slug" class="font-medium">{m.pages_slug()}</label>
    <div class="flex gap-2">
      <Input
        id="seo-slug"
        name="slug"
        dir="ltr"
        required
        maxlength={100}
        class="font-mono"
        bind:value={slug}
        oninput={onchange}
        aria-invalid={invalid('slug')}
        aria-describedby="seo-slug-hint"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="h-9"
        disabled={!slugify(title)}
        onclick={() => {
          slug = slugify(title);
          onchange();
        }}
      >
        {m.pages_slug_generate()}
      </Button>
    </div>
    <p id="seo-slug-hint" class="text-muted-foreground text-xs">
      {m.pages_slug_hint()}
      {#if isHome}{m.pages_slug_home_hint({ locale: locale.toLowerCase() })}{/if}
      {#if reserved.length > 0}{m.pages_slug_reserved_list({ slugs: reserved.join(', ') })}{/if}
    </p>
  </div>

  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.seo_meta_title()}</span>
    <Input
      name="seo.metaTitle"
      {dir}
      lang={locale}
      maxlength={200}
      placeholder={title}
      bind:value={seo.metaTitle}
      oninput={onchange}
      aria-invalid={invalid('seo.metaTitle')}
    />
    <span class="text-muted-foreground text-xs">{counter(shownTitle, RECOMMENDED.title)}</span>
  </label>

  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.seo_meta_description()}</span>
    <textarea
      name="seo.metaDescription"
      class={textareaClass}
      {dir}
      lang={locale}
      maxlength={500}
      bind:value={seo.metaDescription}
      oninput={onchange}
      aria-invalid={invalid('seo.metaDescription')}></textarea>
    <span class="text-muted-foreground text-xs">
      {counter(seo.metaDescription, RECOMMENDED.description)}
    </span>
  </label>

  <section class="grid gap-1 rounded-md border p-3" aria-label={m.seo_preview()}>
    <span class="text-muted-foreground text-xs font-medium">{m.seo_preview()}</span>
    <span class="truncate text-xs text-emerald-700 dark:text-emerald-400" dir="ltr">{address}</span>
    <span class="line-clamp-1 text-base text-blue-700 dark:text-blue-400" {dir} lang={locale}>
      {shownTitle || m.seo_preview_untitled()}
    </span>
    <span class="text-muted-foreground line-clamp-2 text-xs" {dir} lang={locale}>
      {shownDescription || m.seo_preview_no_description()}
    </span>
  </section>

  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.seo_summary()}</span>
    <textarea
      name="seo.summary"
      class={textareaClass}
      {dir}
      lang={locale}
      maxlength={500}
      bind:value={seo.summary}
      oninput={onchange}
      aria-invalid={invalid('seo.summary')}></textarea>
    <span class="text-muted-foreground text-xs">{m.seo_summary_hint()}</span>
  </label>

  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.seo_keywords()}</span>
    <textarea
      name="seo.keywords"
      class="{textareaClass} min-h-16"
      {dir}
      lang={locale}
      bind:value={keywordText}
      oninput={() => {
        seo.keywords = keywordText
          .split('\n')
          .map((k) => k.trim())
          .filter(Boolean);
        onchange();
      }}
      aria-invalid={invalid('seo.keywords')}></textarea>
    <span class="text-muted-foreground text-xs">{m.seo_keywords_hint()}</span>
  </label>

  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.seo_canonical()}</span>
    <Input
      name="seo.canonical"
      dir="ltr"
      type="url"
      maxlength={2000}
      placeholder="{frontendBaseUrl}{path}"
      bind:value={seo.canonical}
      oninput={onchange}
      aria-invalid={invalid('seo.canonical')}
    />
    <span class="text-muted-foreground text-xs">{m.seo_canonical_hint()}</span>
  </label>

  <fieldset class="grid gap-1 text-sm">
    <legend class="mb-1 font-medium">{m.seo_robots()}</legend>
    <label class="flex items-center gap-2">
      <input type="checkbox" name="seo.robots.index" bind:checked={seo.robots.index} {onchange} />
      {m.seo_robots_index()}
    </label>
    <label class="flex items-center gap-2">
      <input type="checkbox" name="seo.robots.follow" bind:checked={seo.robots.follow} {onchange} />
      {m.seo_robots_follow()}
    </label>
  </fieldset>

  <details
    class="rounded-md border"
    open={Boolean(seo.ogTitle || seo.ogDescription || seo.ogImage)}
  >
    <summary class="cursor-pointer px-3 py-2 text-sm font-medium">{m.seo_og()}</summary>
    <div class="grid gap-4 border-t p-3">
      <label class="grid gap-1 text-sm">
        <span class="font-medium">{m.seo_og_title()}</span>
        <Input
          name="seo.ogTitle"
          {dir}
          lang={locale}
          maxlength={200}
          placeholder={shownTitle}
          bind:value={seo.ogTitle}
          oninput={onchange}
          aria-invalid={invalid('seo.ogTitle')}
        />
      </label>
      <label class="grid gap-1 text-sm">
        <span class="font-medium">{m.seo_og_description()}</span>
        <textarea
          name="seo.ogDescription"
          class={textareaClass}
          {dir}
          lang={locale}
          maxlength={500}
          placeholder={shownDescription}
          bind:value={seo.ogDescription}
          oninput={onchange}
          aria-invalid={invalid('seo.ogDescription')}></textarea>
      </label>
      <MediaPicker
        id="seo-og-image"
        name="seo.ogImage"
        label={m.seo_og_image()}
        hint={m.seo_og_image_hint()}
        kind="image"
        value={seo.ogImage ? (media[seo.ogImage] ?? null) : null}
        invalid={invalid('seo.ogImage')}
        onchange={(item) => {
          if (item) media[item.id] = item;
          seo.ogImage = item?.id ?? null;
          onchange();
        }}
      />
      <p class="text-muted-foreground text-xs">{m.seo_og_fallback()}</p>
    </div>
  </details>

  <details class="rounded-md border">
    <summary class="cursor-pointer px-3 py-2 text-sm font-medium">{m.seo_schema()}</summary>
    <div class="grid gap-2 border-t p-3">
      <p class="text-muted-foreground text-xs">{m.seo_schema_hint()}</p>
      <pre
        class="bg-muted max-h-64 overflow-auto rounded p-2 text-xs"
        dir="ltr">{schemaPreview}</pre>
    </div>
  </details>
</div>
