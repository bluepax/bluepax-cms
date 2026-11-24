<script lang="ts">
  import { page } from '$app/state';
  import { m } from '#lib/paraglide/messages.js';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();

  const links = [
    { href: '/settings', label: m.settings_general() },
    { href: '/settings/languages', label: m.settings_languages() },
    { href: '/settings/contact', label: m.settings_contact() },
    { href: '/settings/entities', label: m.settings_entities() },
    { href: '/settings/navigation', label: m.settings_navigation() },
    { href: '/settings/email', label: m.settings_email() },
    { href: '/settings/config', label: m.settings_config() },
  ];
  const current = $derived(
    links.findLast(
      (l) => page.url.pathname === l.href || page.url.pathname.startsWith(`${l.href}/`),
    )?.href,
  );
</script>

<h1 class="mb-6 text-2xl font-semibold">{m.nav_settings()}</h1>
<nav class="mb-6 flex flex-wrap gap-1 border-b">
  {#each links as link (link.href)}
    <a
      href={link.href}
      class="-mb-px border-b-2 px-3 py-2 text-sm {current === link.href
        ? 'border-primary font-medium'
        : 'text-muted-foreground border-transparent'}"
      aria-current={current === link.href ? 'page' : undefined}
    >
      {link.label}
    </a>
  {/each}
</nav>

{@render children()}
