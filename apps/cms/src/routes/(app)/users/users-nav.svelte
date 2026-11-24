<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';

  let { current }: { current: string } = $props();
  const links = [
    { href: '/users', label: m.users_title() },
    { href: '/users/roles', label: m.users_roles() },
    { href: '/users/audit', label: m.users_audit() },
  ];
</script>

<nav class="mb-4 flex gap-1 border-b">
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
