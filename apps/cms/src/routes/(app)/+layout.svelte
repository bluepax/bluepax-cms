<script lang="ts">
  import { page } from '$app/state';
  import FileTextIcon from '@lucide/svelte/icons/file-text';
  import HouseIcon from '@lucide/svelte/icons/house';
  import ImageIcon from '@lucide/svelte/icons/image';
  import InfoIcon from '@lucide/svelte/icons/info';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import SettingsIcon from '@lucide/svelte/icons/settings';
  import UserIcon from '@lucide/svelte/icons/user';
  import UsersIcon from '@lucide/svelte/icons/users';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // Menu labels are message keys declared in the module manifests.
  const messages = m as unknown as Record<string, (() => string) | undefined>;
  const label = (key: string) => messages[key]?.() ?? key;
  const icons: Record<string, typeof HouseIcon> = {
    '/pages': FileTextIcon,
    '/media': ImageIcon,
    '/settings': SettingsIcon,
    '/users': UsersIcon,
  };

  const active = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const nav = $derived([
    { label: m.nav_home(), href: '/', icon: HouseIcon },
    ...data.menu.map((item) => ({
      label: label(item.label),
      href: item.href,
      icon: icons[item.href] ?? InfoIcon,
    })),
    { label: m.nav_about(), href: '/about', icon: InfoIcon },
  ]);
</script>

<div class="flex min-h-svh">
  <aside class="bg-sidebar text-sidebar-foreground hidden w-60 shrink-0 flex-col border-r md:flex">
    <div class="px-5 py-4 text-base font-semibold">{m.app_name()}</div>
    <nav class="flex-1 space-y-1 px-3">
      {#each nav as item (item.href)}
        <a
          href={item.href}
          class="hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-3 py-2 text-sm"
          class:bg-sidebar-accent={active(item.href)}
          class:font-medium={active(item.href)}
          aria-current={active(item.href) ? 'page' : undefined}
        >
          <item.icon class="size-4" />
          {item.label}
        </a>
      {/each}
    </nav>
    <div class="border-t p-3 text-sm">
      <a
        href="/account"
        class="hover:bg-sidebar-accent flex items-center gap-2 rounded-md px-3 py-2"
      >
        <UserIcon class="size-4" />
        <span class="min-w-0">
          <span class="block truncate font-medium">{data.user.displayName}</span>
          <span class="text-muted-foreground block truncate text-xs">{data.user.roleName}</span>
        </span>
      </a>
      <form method="POST" action="/logout">
        <Button type="submit" variant="ghost" class="w-full justify-start gap-2 px-3">
          <LogOutIcon class="size-4" />
          {m.logout()}
        </Button>
      </form>
    </div>
  </aside>

  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex items-center justify-between border-b px-4 py-3 md:hidden">
      <span class="font-semibold">{m.app_name()}</span>
      <nav class="flex gap-3 text-sm">
        {#each nav as item (item.href)}
          <a href={item.href}>{item.label}</a>
        {/each}
        <a href="/account">{m.nav_account()}</a>
      </nav>
    </header>
    <main class="mx-auto w-full max-w-6xl flex-1 p-6">
      {@render children()}
    </main>
  </div>
</div>
