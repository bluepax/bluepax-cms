<script lang="ts">
  import ImageIcon from '@lucide/svelte/icons/image';
  import XIcon from '@lucide/svelte/icons/x';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';

  // Chooses one media item from the library and submits its ID in a hidden field (empty for
  // none). The list comes from /media/picker; only files that fit (`kind`, `mime`) are shown.
  interface Item {
    id: string;
    name: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    thumbUrl: string | null;
  }

  let {
    id,
    name,
    label,
    hint,
    value = null,
    kind,
    mime,
    invalid = false,
    error,
  }: {
    id: string;
    name: string;
    label: string;
    hint?: string;
    value?: Item | null;
    kind?: 'image' | 'video' | 'document';
    mime?: string;
    invalid?: boolean;
    error?: string | null;
  } = $props();

  let selected = $derived(value);
  let dialog = $state<HTMLDialogElement>();
  let items = $state<Item[]>([]);
  let total = $state(0);
  let query = $state('');
  let loading = $state(false);
  let failed = $state(false);

  async function load(page = 1) {
    loading = true;
    failed = false;
    const params = new URLSearchParams({
      page: String(page),
      ...(kind && { kind }),
      ...(mime && { mime }),
      ...(query.trim() && { q: query.trim() }),
    });
    try {
      const response = await fetch(`/media/picker?${params}`);
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { items: Item[]; total: number };
      items = page === 1 ? body.items : [...items, ...body.items];
      total = body.total;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  function open() {
    dialog?.showModal();
    void load();
  }

  function choose(item: Item) {
    selected = item;
    dialog?.close();
  }
</script>

<div class="grid gap-2">
  <span class="text-sm font-medium" id="{id}-label">{label}</span>
  <input type="hidden" {name} value={selected?.id ?? ''} />
  <div class="flex items-center gap-3">
    <div
      class="bg-muted flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border"
      class:border-destructive={invalid}
    >
      {#if selected?.thumbUrl}
        <img src={selected.thumbUrl} alt="" class="max-h-full max-w-full object-contain" />
      {:else}
        <ImageIcon class="text-muted-foreground size-6" />
      {/if}
    </div>
    <div class="grid min-w-0 gap-1">
      <span class="truncate text-sm">
        {#if selected}
          <a href="/media/{selected.id}" class="hover:underline">{selected.name}</a>
        {:else}
          <span class="text-muted-foreground">{m.media_picker_none()}</span>
        {/if}
      </span>
      <div class="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={open}
          aria-describedby="{id}-label"
        >
          {selected ? m.media_picker_change() : m.media_picker_choose()}
        </Button>
        {#if selected}
          <Button type="button" variant="ghost" size="sm" onclick={() => (selected = null)}>
            {m.media_picker_remove()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
  {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
  {#if hint}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
</div>

<dialog
  bind:this={dialog}
  aria-labelledby="{id}-dialog-title"
  class="bg-background text-foreground m-auto w-[min(56rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/40"
>
  <div class="flex items-center justify-between border-b px-4 py-3">
    <h2 id="{id}-dialog-title" class="font-semibold">{label}</h2>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={m.cancel()}
      onclick={() => dialog?.close()}
    >
      <XIcon class="size-4" />
    </Button>
  </div>
  <div class="grid gap-4 p-4">
    <!-- No <form> here: the picker sits inside the page's form, and forms cannot nest. -->
    <div class="flex gap-2" role="search">
      <Input
        type="search"
        bind:value={query}
        placeholder={m.media_search()}
        aria-label={m.media_search()}
        onkeydown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          void load();
        }}
      />
      <Button type="button" variant="outline" onclick={() => load()}>
        {m.media_search_submit()}
      </Button>
    </div>
    {#if failed}
      <p class="text-destructive text-sm">{m.media_picker_failed()}</p>
    {:else if !loading && items.length === 0}
      <p class="text-muted-foreground text-sm">
        {m.media_picker_empty()} <a href="/media" class="underline">{m.media_picker_upload()}</a>
      </p>
    {/if}
    <ul class="grid max-h-[60vh] grid-cols-3 gap-3 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
      {#each items as item (item.id)}
        <li>
          <button
            type="button"
            class="hover:border-primary focus-visible:border-primary block w-full overflow-hidden rounded-md border text-left"
            class:border-primary={selected?.id === item.id}
            onclick={() => choose(item)}
          >
            <span class="bg-muted flex aspect-square items-center justify-center">
              {#if item.thumbUrl}
                <img
                  src={item.thumbUrl}
                  alt=""
                  loading="lazy"
                  class="max-h-full max-w-full object-contain"
                />
              {/if}
            </span>
            <span class="block truncate p-1 text-xs" title={item.name}>{item.name}</span>
            {#if item.width && item.height}
              <span class="text-muted-foreground block px-1 pb-1 text-xs">
                {item.width}×{item.height}
              </span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
    {#if items.length < total}
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={loading}
          onclick={() => load(Math.floor(items.length / 48) + 1)}
        >
          {m.media_picker_more()}
        </Button>
      </div>
    {/if}
  </div>
</dialog>
