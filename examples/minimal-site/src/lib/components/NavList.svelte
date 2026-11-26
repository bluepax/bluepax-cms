<script lang="ts">
  import type { NavItem } from '@bluepax/cms-client';
  import { safeHref } from '#lib/links.ts';
  import NavList from './NavList.svelte';

  // A menu from `/site` (`navigation.header` / `.footer`): a tree whose items link to a path,
  // URL, mailto: or tel:, or are headings (`href` null).
  let { items, current }: { items: NavItem[]; current: string } = $props();
</script>

<ul>
  {#each items as item (item.id)}
    {@const href = safeHref(item.href)}
    <li>
      {#if href}
        <a
          {href}
          aria-current={href === current ? 'page' : undefined}
          target={item.newTab ? '_blank' : undefined}
          rel={item.newTab ? 'noopener noreferrer' : undefined}
        >
          {item.label}
        </a>
      {:else}
        <span>{item.label}</span>
      {/if}
      {#if item.children.length > 0}
        <NavList items={item.children} {current} />
      {/if}
    </li>
  {/each}
</ul>
