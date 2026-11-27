<script lang="ts">
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import XIcon from '@lucide/svelte/icons/x';
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { selectClass } from '#lib/ui.ts';

  // Picks records from a list, in order: the chosen ones as a list that can be reordered, and a
  // select with the rest. Used for the categories, tags and authors of a post.
  let {
    id,
    label,
    hint,
    options,
    value = $bindable(),
    max,
    ordered = true,
    invalid = false,
    dir,
    onchange,
  }: {
    id: string;
    label: string;
    hint?: string;
    options: { id: string; label: string }[];
    /** Chosen IDs, in order. */
    value: string[];
    max: number;
    /** Whether the order matters (shows move buttons). */
    ordered?: boolean;
    invalid?: boolean;
    dir?: 'ltr' | 'rtl';
    onchange: () => void;
  } = $props();

  const labelOf = (key: string) => options.find((o) => o.id === key)?.label ?? key;
  const rest = $derived(options.filter((o) => !value.includes(o.id)));

  function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= value.length) return;
    const next = [...value];
    const [item] = next.splice(index, 1);
    next.splice(to, 0, item!);
    value = next;
    onchange();
  }

  function remove(index: number) {
    value = value.filter((_, i) => i !== index);
    onchange();
  }

  function add(event: Event & { currentTarget: HTMLSelectElement }) {
    const chosen = event.currentTarget.value;
    event.currentTarget.value = '';
    if (!chosen || value.includes(chosen) || value.length >= max) return;
    value = [...value, chosen];
    onchange();
  }
</script>

<div class="grid gap-2" role="group" aria-labelledby="{id}-label">
  <span id="{id}-label" class="text-sm font-medium">{label}</span>
  {#if value.length > 0}
    <ul class="grid gap-1" class:text-destructive={invalid}>
      {#each value as key, index (key)}
        <li class="bg-muted/50 flex items-center gap-1 rounded-md border px-2 py-1 text-sm">
          {#if ordered}
            <span class="text-muted-foreground w-5 font-mono text-xs">{index + 1}</span>
          {/if}
          <span class="flex-1 truncate" {dir}>{labelOf(key)}</span>
          {#if ordered}
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
          {/if}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-7"
            aria-label={m.posts_remove_item({ name: labelOf(key) })}
            onclick={() => remove(index)}
          >
            <XIcon class="size-3.5" />
          </Button>
        </li>
      {/each}
    </ul>
  {/if}
  {#if rest.length > 0 && value.length < max}
    <select
      id="{id}-add"
      class={selectClass}
      aria-label={m.posts_add_item({ label })}
      aria-invalid={invalid}
      onchange={add}
    >
      <option value="">{m.posts_add_item({ label })}</option>
      {#each rest as option (option.id)}
        <option value={option.id}>{option.label}</option>
      {/each}
    </select>
  {:else if options.length === 0}
    <p class="text-muted-foreground text-xs">{m.posts_none_to_pick()}</p>
  {/if}
  {#if hint}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
</div>
