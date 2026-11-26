<script lang="ts">
  import { routePath, type Site } from '@bluepax/cms-client';
  import { page } from '$app/state';
  import { messages } from '#lib/i18n.ts';
  import LanguageSwitcher from './LanguageSwitcher.svelte';
  import MediaImage from './MediaImage.svelte';
  import NavList from './NavList.svelte';

  let { site, alternates }: { site: Site; alternates: Record<string, string> | null } = $props();

  const t = $derived(messages(site.locale));
  const home = $derived(routePath(site.frontend.routes.home, { locale: site.locale }));
</script>

<header class="site-header">
  <div class="container bar">
    <a class="brand" href={home}>
      {#if site.branding.logo}
        <MediaImage media={site.branding.logo} locale={site.locale} class="logo" eager />
        <span class="visually-hidden">{site.name}</span>
      {:else}
        {site.name}
      {/if}
    </a>
    {#if site.navigation.header.length > 0}
      <nav class="menu" aria-label={t.menu}>
        <NavList items={site.navigation.header} current={page.url.pathname} />
      </nav>
    {/if}
    <LanguageSwitcher {site} {alternates} />
  </div>
</header>
