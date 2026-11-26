<script lang="ts">
  import type { Site } from '@bluepax/cms-client';
  import { languageName, messages } from '#lib/i18n.ts';

  // `alternates` is the shown content's address per published language (`/routes/resolve`).
  // Languages without a published version are left out: their addresses answer 404 and nothing
  // falls back to another language (chapter 6). Pages without content (errors) show no switcher.
  let { site, alternates }: { site: Site; alternates: Record<string, string> | null } = $props();

  const t = $derived(messages(site.locale));
  const links = $derived.by(() => {
    const entries = Object.entries(alternates ?? {});
    const order = site.languages.content.map((l) => l.code.toLowerCase());
    const rank = (code: string) => {
      const index = order.indexOf(code.toLowerCase());
      return index === -1 ? order.length : index;
    };
    return entries
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([code, href]) => ({
        code,
        href,
        current: code.toLowerCase() === site.locale.toLowerCase(),
      }));
  });
</script>

{#if links.length > 1}
  <nav class="languages" aria-label={t.languages}>
    <ul>
      {#each links as link (link.code)}
        <li>
          <a
            href={link.href}
            hreflang={link.code}
            lang={link.code}
            aria-current={link.current ? 'true' : undefined}
          >
            {languageName(link.code)}
          </a>
        </li>
      {/each}
    </ul>
  </nav>
{/if}
