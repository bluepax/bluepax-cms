<script lang="ts" module>
  /** A post as the picker shows it; `locale` is the language its title is in. */
  export interface PickedPost {
    id: string;
    title: string;
    locale: string;
    /** Status in the picker's language; null when the post has no version in it. */
    status: string | null;
  }
</script>

<script lang="ts">
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import XIcon from '@lucide/svelte/icons/x';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { statusClass, statusText } from '#lib/pages.ts';

  // Picks posts by hand, in order (featured-posts block). The chosen posts are a list that can
  // be reordered; "add" searches /posts/picker, limited to a category when one is set. It must
  // not render its own <form>: it sits inside the page editor's form.
  let {
    id,
    value,
    known = $bindable(),
    locale,
    categoryId,
    max,
    invalid,
    onchange,
  }: {
    id: string;
    /** Chosen post IDs, in order. */
    value: string[];
    /** Posts the picker knows by ID, to show the chosen ones; results are added to it. */
    known: Record<string, PickedPost>;
    locale: string;
    categoryId: string | null;
    max: number;
    invalid: (path: string) => boolean;
    onchange: (ids: string[]) => void;
  } = $props();

  let open = $state(false);
  let query = $state('');
  let results = $state<PickedPost[]>([]);
  let loading = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function search() {
    loading = true;
    const params = new URLSearchParams({
      locale,
      q: query,
      ...(categoryId && { category: categoryId }),
    });
    try {
      const response = await fetch(`/posts/picker?${params}`);
      const body = (await response.json()) as { items: PickedPost[] };
      results = body.items;
      for (const item of body.items) known[item.id] = item;
    } finally {
      loading = false;
    }
  }

  function toggle() {
    open = !open;
    if (open) void search();
  }

  function typed() {
    clearTimeout(timer);
    timer = setTimeout(() => void search(), 250);
  }

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    onchange(next);
  }
</script>

<div class="grid gap-2" role="group" aria-labelledby="{id}-label">
  <span id="{id}-label" class="text-sm font-medium">{m.blocks_posts_chosen({ max })}</span>
  {#if value.length === 0}
    <p class="text-muted-foreground text-sm">{m.blocks_posts_none_chosen()}</p>
  {:else}
    <ol class="grid gap-1">
      {#each value as postId, index (postId)}
        {@const post = known[postId]}
        <li
          class="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
          class:border-destructive={invalid(`postIds.${index}`)}
        >
          <span class="text-muted-foreground w-5 font-mono text-xs">{index + 1}</span>
          <span class="flex-1 truncate">
            {post?.title ?? m.blocks_posts_missing()}
            {#if post && post.locale !== locale}
              <span class="text-muted-foreground font-mono text-xs">({post.locale})</span>
            {/if}
          </span>
          {#if post}
            <span class="rounded px-1.5 py-0.5 text-xs {statusClass(post.status)}">
              {post.status ? statusText(post.status) : m.pages_status_missing()}
            </span>
          {/if}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-7"
            disabled={index === 0}
            aria-label={m.blocks_move_up()}
            onclick={() => move(index, -1)}
          >
            <ArrowUpIcon class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-7"
            disabled={index === value.length - 1}
            aria-label={m.blocks_move_down()}
            onclick={() => move(index, 1)}
          >
            <ArrowDownIcon class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-7"
            aria-label={m.blocks_remove_item()}
            onclick={() => onchange(value.filter((v) => v !== postId))}
          >
            <XIcon class="size-3.5" />
          </Button>
        </li>
      {/each}
    </ol>
  {/if}
  <div>
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={value.length >= max}
      aria-expanded={open}
      aria-controls="{id}-search"
      onclick={toggle}
    >
      <PlusIcon class="size-4" />
      {m.blocks_posts_add()}
    </Button>
  </div>
  {#if open}
    <div id="{id}-search" class="grid gap-2 rounded-md border p-3">
      <Input
        type="search"
        placeholder={m.pages_search()}
        aria-label={m.pages_search()}
        bind:value={query}
        oninput={typed}
        onkeydown={(event) => {
          // Enter would submit the page form around the picker.
          if (event.key === 'Enter') {
            event.preventDefault();
            void search();
          }
        }}
      />
      {#if loading && results.length === 0}
        <p class="text-muted-foreground text-sm">{m.blocks_posts_loading()}</p>
      {:else if results.length === 0}
        <p class="text-muted-foreground text-sm">{m.blocks_posts_no_results()}</p>
      {:else}
        <ul class="grid max-h-64 gap-1 overflow-y-auto">
          {#each results as post (post.id)}
            {@const chosen = value.includes(post.id)}
            <li>
              <button
                type="button"
                class="hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-start text-sm disabled:opacity-50"
                disabled={chosen || value.length >= max}
                onclick={() => onchange([...value, post.id])}
              >
                <span class="flex-1 truncate">
                  {post.title}
                  {#if post.locale !== locale}
                    <span class="text-muted-foreground font-mono text-xs">({post.locale})</span>
                  {/if}
                </span>
                <span class="rounded px-1.5 py-0.5 text-xs {statusClass(post.status)}">
                  {post.status ? statusText(post.status) : m.pages_status_missing()}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>
