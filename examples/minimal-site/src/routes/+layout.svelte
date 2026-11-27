<script lang="ts">
  import { page } from '$app/state';
  import SiteFooter from '#lib/components/SiteFooter.svelte';
  import SiteHeader from '#lib/components/SiteHeader.svelte';
  import { messages } from '#lib/i18n.ts';
  import { variantUrl } from '#lib/media.ts';
  import '../app.css';

  let { children } = $props();

  // Page data wins over layout data: the preview route loads the site in the previewed language.
  const site = $derived(page.data.site);
  const t = $derived(messages(site?.locale));
  const icon = $derived(site?.branding.icon ?? null);
</script>

<svelte:head>
  {#if site}
    {#if variantUrl(icon, 'favicon')}
      <link rel="icon" href={variantUrl(icon, 'favicon')} sizes="48x48" />
    {/if}
    {#if variantUrl(icon, 'apple-touch')}
      <link rel="apple-touch-icon" href={variantUrl(icon, 'apple-touch')} />
    {/if}
    {#if site.branding.themeColor}
      <meta name="theme-color" content={site.branding.themeColor} />
    {/if}
  {/if}
</svelte:head>

<a class="skip" href="#content">{t.skip}</a>
{#if site}
  <SiteHeader {site} alternates={page.data.alternates ?? null} />
{/if}
<main id="content">
  {@render children()}
</main>
{#if site}
  <SiteFooter {site} />
{/if}
