<script lang="ts">
  import type { Site } from '@bluepax/cms-client';
  import { page } from '$app/state';
  import { messages } from '#lib/i18n.ts';
  import { safeHref } from '#lib/links.ts';
  import NavList from './NavList.svelte';

  let { site }: { site: Site } = $props();
  const t = $derived(messages(site.locale));
</script>

<footer class="site-footer">
  <div class="container">
    {#if site.navigation.footer.length > 0}
      <nav class="footer-menu">
        <NavList items={site.navigation.footer} current={page.url.pathname} />
      </nav>
    {/if}
    {#if site.contact.email || site.contact.phone}
      <p class="contact">
        <span>{t.contact}:</span>
        {#if site.contact.email}<a href={`mailto:${site.contact.email}`}>
            {site.contact.email}
          </a>{/if}
        {#if site.contact.phone}<a href={`tel:${site.contact.phone}`}>{site.contact.phone}</a>{/if}
      </p>
    {/if}
    {#if site.social.length > 0}
      <ul class="social">
        {#each site.social as link (link.url)}
          {@const href = safeHref(link.url)}
          {#if href}
            <li><a {href} rel="me noopener noreferrer" target="_blank">{link.network}</a></li>
          {/if}
        {/each}
      </ul>
    {/if}
    {#if site.legalEntities.length > 0}
      <p class="legal">{site.legalEntities.map((e) => e.legalName).join(' · ')}</p>
    {/if}
    {#if site.footer.text}
      <p class="footer-text">{site.footer.text}</p>
    {/if}
  </div>
</footer>
