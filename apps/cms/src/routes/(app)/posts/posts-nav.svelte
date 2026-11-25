<script lang="ts">
  import { m } from '#lib/paraglide/messages.js';

  // Sections of the posts module: posts, categories, tags and authors.
  let { current }: { current: string } = $props();
  const links = [
    { href: '/posts', label: m.nav_posts() },
    { href: '/posts/categories', label: m.posts_categories() },
    { href: '/posts/tags', label: m.posts_tags() },
    { href: '/posts/authors', label: m.posts_authors() },
  ];
</script>

<nav class="mb-4 flex gap-1 border-b" aria-label={m.nav_posts()}>
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
