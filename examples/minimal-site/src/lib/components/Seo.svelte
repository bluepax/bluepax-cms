<script lang="ts">
  import { jsonLdScript, type Seo } from '@bluepax/cms-client';

  // The `seo` object of a page, post, category, tag or author (chapter 6, checklist step 4):
  // the CMS has already applied every fallback, so the frontend writes it out as it is.
  let { seo }: { seo: Seo } = $props();
</script>

<svelte:head>
  <title>{seo.title}</title>
  {#if seo.description}
    <meta name="description" content={seo.description} />
  {/if}
  <link rel="canonical" href={seo.canonical} />
  <meta name="robots" content={seo.robots} />
  {#if seo.keywords.length > 0}
    <meta name="keywords" content={seo.keywords.join(', ')} />
  {/if}
  {#each seo.hreflang as alternate (alternate.hreflang)}
    <link rel="alternate" hreflang={alternate.hreflang} href={alternate.href} />
  {/each}
  <meta property="og:type" content={seo.og.type} />
  <meta property="og:title" content={seo.og.title} />
  {#if seo.og.description}
    <meta property="og:description" content={seo.og.description} />
  {/if}
  <meta property="og:url" content={seo.og.url} />
  <meta property="og:site_name" content={seo.og.siteName} />
  <meta property="og:locale" content={seo.og.locale} />
  {#if seo.og.image}
    <meta property="og:image" content={seo.og.image.url} />
    <meta property="og:image:type" content={seo.og.image.type} />
    {#if seo.og.image.width && seo.og.image.height}
      <meta property="og:image:width" content={String(seo.og.image.width)} />
      <meta property="og:image:height" content={String(seo.og.image.height)} />
    {/if}
    {#if seo.og.image.alt}
      <meta property="og:image:alt" content={seo.og.image.alt} />
    {/if}
    <meta name="twitter:card" content="summary_large_image" />
  {:else}
    <meta name="twitter:card" content="summary" />
  {/if}
  <!-- jsonLdScript escapes <, > and &, so the CMS data cannot close the element. -->
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html jsonLdScript(seo.jsonLd)}
</svelte:head>
