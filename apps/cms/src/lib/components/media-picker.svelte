<script lang="ts">
  import ImageIcon from '@lucide/svelte/icons/image';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import MediaDialog, { type PickedMedia } from './media-dialog.svelte';

  // Chooses one media item from the library. With `name` it submits the ID in a hidden field
  // (empty for none); `onchange` reports every change, e.g. to a block editor. The list comes
  // from /media/picker; only files that fit (`kind`, `mime`) are shown.
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
    compact = false,
    onchange,
  }: {
    id: string;
    name?: string;
    label: string;
    hint?: string;
    value?: PickedMedia | null;
    /** One kind, or several separated by commas (`image,video`). */
    kind?: string;
    mime?: string;
    invalid?: boolean;
    error?: string | null;
    /** A smaller preview, e.g. for items in a list. */
    compact?: boolean;
    onchange?: (item: PickedMedia | null) => void;
  } = $props();

  let selected = $derived(value);
  let dialog = $state<MediaDialog>();

  function choose(item: PickedMedia | null) {
    selected = item;
    onchange?.(item);
  }
</script>

<div class="grid gap-2">
  <span class="text-sm font-medium" id="{id}-label">{label}</span>
  {#if name}<input type="hidden" {name} value={selected?.id ?? ''} />{/if}
  <div class="flex items-center gap-3">
    <div
      class="bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-md border {compact
        ? 'size-12'
        : 'size-20'}"
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
          <a href="/media/{selected.id}" class="hover:underline" target="_blank">{selected.name}</a>
        {:else}
          <span class="text-muted-foreground">{m.media_picker_none()}</span>
        {/if}
      </span>
      <div class="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={() => dialog?.open()}
          aria-describedby="{id}-label"
          aria-invalid={invalid}
        >
          {selected ? m.media_picker_change() : m.media_picker_choose()}
        </Button>
        {#if selected}
          <Button type="button" variant="ghost" size="sm" onclick={() => choose(null)}>
            {m.media_picker_remove()}
          </Button>
        {/if}
      </div>
    </div>
  </div>
  {#if error}<p class="text-destructive text-sm" role="alert">{error}</p>{/if}
  {#if hint}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
</div>

<MediaDialog
  bind:this={dialog}
  {id}
  title={label}
  {kind}
  {mime}
  selectedId={selected?.id ?? null}
  onselect={choose}
/>
