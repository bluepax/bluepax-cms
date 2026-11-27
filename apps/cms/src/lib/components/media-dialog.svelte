<script lang="ts" module>
  /** A media item as the picker lists it (/media/picker). */
  export interface PickedMedia {
    id: string;
    name: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    thumbUrl: string | null;
  }
</script>

<script lang="ts">
  import XIcon from '@lucide/svelte/icons/x';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';

  // The library browser of the media picker: a modal dialog that lists files that fit (`kind`,
  // `mime`) and reports the chosen one. Call `open()` to show it. It renders no <form>: pickers
  // sit inside page forms, and forms cannot nest.
  let {
    id,
    title,
    kind,
    mime,
    selectedId = null,
    onselect,
  }: {
    id: string;
    title: string;
    /** One kind, or several separated by commas (`image,video`). */
    kind?: string | undefined;
    mime?: string | undefined;
    selectedId?: string | null;
    onselect: (item: PickedMedia) => void;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let items = $state<PickedMedia[]>([]);
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
      const body = (await response.json()) as { items: PickedMedia[]; total: number };
      items = page === 1 ? body.items : [...items, ...body.items];
      total = body.total;
    } catch {
      failed = true;
    } finally {
      loading = false;
    }
  }

  export function open() {
    dialog?.showModal();
    void load();
  }

  function choose(item: PickedMedia) {
    onselect(item);
    dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  aria-labelledby="{id}-dialog-title"
  class="bg-background text-foreground m-auto w-[min(56rem,calc(100vw-2rem))] rounded-lg border p-0 shadow-lg backdrop:bg-black/40"
>
  <div class="flex items-center justify-between border-b px-4 py-3">
    <h2 id="{id}-dialog-title" class="font-semibold">{title}</h2>
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
            class:border-primary={selectedId === item.id}
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
              {:else}
                <span class="text-muted-foreground p-1 text-xs">{item.mimeType}</span>
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
