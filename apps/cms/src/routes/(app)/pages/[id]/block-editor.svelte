<script lang="ts" module>
  /** A block while it is edited; `data` follows the block's schema in @bluepax/cms-blocks. */
  export interface EditedBlock {
    id: string;
    type: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edited through typed fields below
    data: any;
  }
</script>

<script lang="ts">
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import type { PickedMedia } from '#lib/components/media-dialog.svelte';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import PostPicker, { type PickedPost } from '#lib/components/post-picker.svelte';
  import RichTextEditor from '#lib/components/rich-text-editor.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { blockName } from '#lib/pages.ts';
  import { labelIn } from '#lib/posts.ts';
  import { selectClass, textareaClass } from '#lib/ui.ts';

  // Adds, removes, orders and edits the blocks of one language (docs/spec/README.md chapter 4).
  // Only the blocks this instance offers can be added; features of switched-off modules are
  // hidden. Blocks that are no longer offered can be kept or removed, not edited.
  let {
    blocks = $bindable(),
    media = $bindable(),
    offered,
    templates,
    hiddenFeatures,
    dir,
    lang,
    primary,
    postCategories,
    posts = $bindable(),
    invalid,
    onchange,
  }: {
    blocks: EditedBlock[];
    /** Media items shown in the blocks, by ID; pickers add to it. */
    media: Record<string, PickedMedia>;
    primary: string;
    /** Post categories with their names, for the featured-posts and latest-posts blocks. */
    postCategories: { id: string; names: Record<string, string> }[];
    /** Posts shown in featured-posts blocks, by ID; the post picker adds to it. */
    posts: Record<string, PickedPost>;
    offered: string[];
    /** Data of a new block per type. */
    templates: Record<string, unknown>;
    hiddenFeatures: Record<string, string[]>;
    dir: 'ltr' | 'rtl';
    lang: string;
    invalid: (field: string) => boolean;
    onchange: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let adding = $state(offered[0] ?? '');

  const MAX = { buttons: 2, cards: 24, steps: 20, stats: 12, logos: 60 } as const;

  function add() {
    if (!adding) return;
    blocks.push({
      id: crypto.randomUUID(),
      type: adding,
      data: structuredClone(templates[adding]),
    });
    onchange();
  }

  function move<T>(list: T[], index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(to, 0, item!);
    onchange();
  }

  function remove<T>(list: T[], index: number) {
    list.splice(index, 1);
    onchange();
  }

  function pick(item: PickedMedia | null): string | null {
    if (item) media[item.id] = item;
    onchange();
    return item?.id ?? null;
  }

  const resolve = (id: string) => media[id]?.thumbUrl ?? null;
  const shown = (block: EditedBlock, field: string) =>
    !(hiddenFeatures[block.type] ?? []).includes(field);
  const blockFailed = (index: number) => invalid(`blocks.${index}`);
  const field = (index: number, path: string) => `blocks.${index}.data.${path}`;
</script>

{#snippet text(
  obj: Record<string, string>,
  key: string,
  label: string,
  path: string,
  max: number,
  multiline = false,
)}
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{label}</span>
    {#if multiline}
      <textarea
        class={textareaClass}
        {dir}
        {lang}
        maxlength={max}
        bind:value={obj[key]}
        oninput={onchange}
        aria-invalid={invalid(path)}></textarea>
    {:else}
      <Input
        {dir}
        {lang}
        maxlength={max}
        bind:value={obj[key]}
        oninput={onchange}
        aria-invalid={invalid(path)}
      />
    {/if}
  </label>
{/snippet}

{#snippet url(obj: Record<string, string>, key: string, label: string, path: string)}
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{label}</span>
    <Input
      dir="ltr"
      maxlength={2000}
      placeholder="/{lang.toLowerCase()}/…"
      bind:value={obj[key]}
      oninput={onchange}
      aria-invalid={invalid(path)}
    />
  </label>
{/snippet}

{#snippet itemControls(list: unknown[], index: number)}
  <div class="flex gap-1">
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={index === 0}
      aria-label={m.blocks_move_up()}
      onclick={() => move(list, index, -1)}
    >
      <ArrowUpIcon class="size-4" />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled={index === list.length - 1}
      aria-label={m.blocks_move_down()}
      onclick={() => move(list, index, 1)}
    >
      <ArrowDownIcon class="size-4" />
    </Button>
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={m.blocks_remove_item()}
      onclick={() => remove(list, index)}
    >
      <Trash2Icon class="size-4" />
    </Button>
  </div>
{/snippet}

{#snippet button(
  obj: { label: string; url: string },
  path: string,
  controls?: { list: unknown[]; index: number },
)}
  <div class="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
    {@render text(obj, 'label', m.blocks_button_label(), `${path}.label`, 80)}
    {@render url(obj, 'url', m.blocks_link(), `${path}.url`)}
    {#if controls}{@render itemControls(controls.list, controls.index)}{/if}
  </div>
{/snippet}

{#snippet optionalButton(owner: Record<string, unknown>, key: string, label: string, path: string)}
  <label class="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={owner[key] !== null}
      onchange={(event) => {
        owner[key] = event.currentTarget.checked ? { label: '', url: '' } : null;
        onchange();
      }}
    />
    {label}
  </label>
  {#if owner[key]}
    {@render button(owner[key] as { label: string; url: string }, path)}
  {/if}
{/snippet}

{#snippet mediaField(
  owner: Record<string, string | null>,
  key: string,
  id: string,
  label: string,
  path: string,
  kind = 'image',
  compact = false,
)}
  <MediaPicker
    {id}
    {label}
    {kind}
    {compact}
    value={owner[key] ? (media[owner[key]] ?? null) : null}
    invalid={invalid(path)}
    onchange={(item) => (owner[key] = pick(item))}
  />
{/snippet}

{#snippet richText(owner: Record<string, unknown>, id: string, label: string, path: string)}
  <RichTextEditor
    {id}
    {label}
    {dir}
    {lang}
    {resolve}
    value={$state.snapshot(owner.body) as never}
    invalid={invalid(path)}
    onchange={(doc) => {
      owner.body = doc;
      onchange();
    }}
    onmedia={(item) => (media[item.id] = item)}
  />
{/snippet}

{#snippet categoryField(owner: Record<string, unknown>, path: string, hint: string)}
  <label class="grid gap-1 text-sm">
    <span class="font-medium">{m.posts_category()}</span>
    <select
      class={selectClass}
      value={owner.categoryId ?? ''}
      onchange={(event) => {
        owner.categoryId = event.currentTarget.value || null;
        onchange();
      }}
      aria-invalid={invalid(path)}
    >
      <option value="">{m.posts_category_all()}</option>
      {#each postCategories as category (category.id)}
        <option value={category.id}>{labelIn(category.names, lang, primary)}</option>
      {/each}
    </select>
    <span class="text-muted-foreground text-xs">{hint}</span>
  </label>
{/snippet}

{#snippet addItem(list: unknown[], max: number, item: () => unknown)}
  <div>
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={list.length >= max}
      onclick={() => {
        list.push(item());
        onchange();
      }}
    >
      <PlusIcon class="size-4" />
      {m.blocks_add_item()}
    </Button>
  </div>
{/snippet}

<section class="grid gap-4" aria-label={m.blocks_title()}>
  {#each blocks as block, i (block.id)}
    {@const d = block.data}
    {@const uid = `b-${block.id}`}
    <article
      class="bg-card rounded-lg border"
      class:border-destructive={blockFailed(i)}
      aria-labelledby="{uid}-title"
    >
      <header class="flex items-center justify-between gap-2 border-b px-4 py-2">
        <h3 id="{uid}-title" class="text-sm font-semibold">
          <span class="text-muted-foreground mr-1 font-mono">{i + 1}</span>
          {blockName(block.type)}
        </h3>
        <div class="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={i === 0}
            aria-label={m.blocks_move_up()}
            onclick={() => move(blocks, i, -1)}
          >
            <ArrowUpIcon class="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={i === blocks.length - 1}
            aria-label={m.blocks_move_down()}
            onclick={() => move(blocks, i, 1)}
          >
            <ArrowDownIcon class="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={m.blocks_remove()}
            onclick={() => {
              if (confirm(m.blocks_remove_confirm())) remove(blocks, i);
            }}
          >
            <Trash2Icon class="size-4" />
          </Button>
        </div>
      </header>
      <div class="grid gap-4 p-4">
        {#if blockFailed(i)}
          <p class="text-destructive text-sm" role="alert">{m.blocks_invalid()}</p>
        {/if}
        {#if !offered.includes(block.type)}
          <p class="text-muted-foreground text-sm">{m.blocks_unavailable()}</p>
          <pre class="bg-muted max-h-48 overflow-auto rounded p-2 text-xs">{JSON.stringify(
              d,
              null,
              2,
            )}</pre>
        {:else if block.type === 'hero'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {@render text(d, 'subtitle', m.blocks_subtitle(), field(i, 'subtitle'), 500, true)}
          {@render mediaField(
            d,
            'background',
            `${uid}-bg`,
            m.blocks_background(),
            field(i, 'background'),
            'image,video',
          )}
          <fieldset class="grid gap-2">
            <legend class="mb-1 text-sm font-medium">
              {m.blocks_buttons({ max: MAX.buttons })}
            </legend>
            {#each d.buttons as item, j (j)}
              {@render button(item, field(i, `buttons.${j}`), { list: d.buttons, index: j })}
            {/each}
            {@render addItem(d.buttons, MAX.buttons, () => ({ label: '', url: '' }))}
          </fieldset>
          {#if shown(block, 'selector')}
            <p class="text-muted-foreground text-sm">{m.blocks_selector_hint()}</p>
          {/if}
        {:else if block.type === 'text-media'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {@render richText(d, `${uid}-body`, m.blocks_body(), field(i, 'body'))}
          <div class="grid gap-4 sm:grid-cols-2">
            {@render mediaField(d, 'image', `${uid}-image`, m.blocks_image(), field(i, 'image'))}
            <label class="grid content-start gap-1 text-sm">
              <span class="font-medium">{m.blocks_image_position()}</span>
              <select class={selectClass} bind:value={d.imagePosition} {onchange}>
                <option value="start">{m.blocks_image_start()}</option>
                <option value="end">{m.blocks_image_end()}</option>
              </select>
            </label>
          </div>
          {@render optionalButton(d, 'button', m.blocks_with_button(), field(i, 'button'))}
        {:else if block.type === 'cards'}
          <div class="grid gap-4 sm:grid-cols-[1fr_auto]">
            {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
            <label class="grid gap-1 text-sm">
              <span class="font-medium">{m.blocks_columns()}</span>
              <select class={selectClass} bind:value={d.columns} {onchange}>
                {#each [2, 3, 4] as n (n)}<option value={n}>{n}</option>{/each}
              </select>
            </label>
          </div>
          {#each d.cards as card, j (j)}
            <div class="grid gap-3 rounded-md border p-3">
              <div class="flex items-start justify-between gap-2">
                {@render mediaField(
                  card,
                  'icon',
                  `${uid}-card-${j}`,
                  m.blocks_icon(),
                  field(i, `cards.${j}.icon`),
                  'image',
                  true,
                )}
                {@render itemControls(d.cards, j)}
              </div>
              {@render text(
                card,
                'title',
                m.blocks_title_field(),
                field(i, `cards.${j}.title`),
                200,
              )}
              {@render text(
                card,
                'description',
                m.blocks_description(),
                field(i, `cards.${j}.description`),
                1000,
                true,
              )}
              {@render url(card, 'url', m.blocks_link_optional(), field(i, `cards.${j}.url`))}
            </div>
          {/each}
          {@render addItem(d.cards, MAX.cards, () => ({
            icon: null,
            title: '',
            description: '',
            url: '',
          }))}
        {:else if block.type === 'steps'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {#each d.steps as step, j (j)}
            <div class="grid gap-3 rounded-md border p-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium">{m.blocks_step({ n: j + 1 })}</span>
                {@render itemControls(d.steps, j)}
              </div>
              {@render text(
                step,
                'title',
                m.blocks_title_field(),
                field(i, `steps.${j}.title`),
                200,
              )}
              {@render text(
                step,
                'description',
                m.blocks_description(),
                field(i, `steps.${j}.description`),
                1000,
                true,
              )}
            </div>
          {/each}
          {@render addItem(d.steps, MAX.steps, () => ({ title: '', description: '' }))}
        {:else if block.type === 'stats'}
          {#each d.items as item, j (j)}
            <div class="grid items-end gap-2 sm:grid-cols-[8rem_6rem_1fr_auto]">
              {@render text(item, 'value', m.blocks_value(), field(i, `items.${j}.value`), 20)}
              {@render text(item, 'unit', m.blocks_unit(), field(i, `items.${j}.unit`), 20)}
              {@render text(
                item,
                'label',
                m.blocks_stat_label(),
                field(i, `items.${j}.label`),
                200,
              )}
              {@render itemControls(d.items, j)}
            </div>
          {/each}
          {@render addItem(d.items, MAX.stats, () => ({ value: '', unit: '', label: '' }))}
        {:else if block.type === 'logos'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {#each d.logos as logo, j (j)}
            <div class="grid gap-3 rounded-md border p-3">
              <div class="flex items-start justify-between gap-2">
                {@render mediaField(
                  logo,
                  'image',
                  `${uid}-logo-${j}`,
                  m.blocks_logo_image(),
                  field(i, `logos.${j}.image`),
                  'image',
                  true,
                )}
                {@render itemControls(d.logos, j)}
              </div>
              <div class="grid gap-3 sm:grid-cols-2">
                {@render text(logo, 'name', m.blocks_name(), field(i, `logos.${j}.name`), 100)}
                {@render url(logo, 'url', m.blocks_link_optional(), field(i, `logos.${j}.url`))}
              </div>
            </div>
          {/each}
          {@render addItem(d.logos, MAX.logos, () => ({ name: '', image: null, url: '' }))}
        {:else if block.type === 'featured-posts'}
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1 text-sm">
              <span class="font-medium">{m.blocks_posts_mode()}</span>
              <select class={selectClass} bind:value={d.mode} {onchange}>
                <option value="latest">{m.blocks_posts_latest()}</option>
                <option value="manual">{m.blocks_posts_manual()}</option>
              </select>
            </label>
            {#if d.mode === 'latest'}
              <label class="grid gap-1 text-sm">
                <span class="font-medium">{m.blocks_limit()}</span>
                <Input
                  type="number"
                  min={1}
                  max={12}
                  bind:value={d.limit}
                  oninput={onchange}
                  aria-invalid={invalid(field(i, 'limit'))}
                />
              </label>
            {/if}
          </div>
          {@render categoryField(
            d,
            field(i, 'categoryId'),
            d.mode === 'latest'
              ? m.blocks_posts_category_latest()
              : m.blocks_posts_category_manual(),
          )}
          {#if d.mode === 'manual'}
            <PostPicker
              id="{uid}-posts"
              value={d.postIds}
              bind:known={posts}
              locale={lang}
              categoryId={d.categoryId}
              max={12}
              invalid={(path) => invalid(field(i, path))}
              onchange={(ids) => {
                d.postIds = ids;
                onchange();
              }}
            />
          {/if}
        {:else if block.type === 'latest-posts'}
          <div class="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <label class="grid content-start gap-1 text-sm">
              <span class="font-medium">{m.blocks_limit()}</span>
              <Input
                type="number"
                min={1}
                max={24}
                bind:value={d.limit}
                oninput={onchange}
                aria-invalid={invalid(field(i, 'limit'))}
              />
            </label>
            {@render categoryField(d, field(i, 'categoryId'), m.blocks_posts_category_latest())}
          </div>
        {:else if block.type === 'contact-cta'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {@render text(
            d,
            'description',
            m.blocks_description(),
            field(i, 'description'),
            1000,
            true,
          )}
          {#if shown(block, 'showForm')}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={d.showForm} {onchange} />
              {m.blocks_show_form()}
            </label>
          {/if}
          <label class="flex items-center gap-2 text-sm">
            <input type="checkbox" bind:checked={d.showIm} {onchange} />
            {m.blocks_show_im()}
          </label>
          {@render optionalButton(d, 'link', m.blocks_with_link(), field(i, 'link'))}
        {:else if block.type === 'rich-text'}
          {@render text(d, 'title', m.blocks_title_field(), field(i, 'title'), 200)}
          {@render richText(d, `${uid}-body`, m.blocks_body(), field(i, 'body'))}
        {:else}
          <p class="text-muted-foreground text-sm">{m.blocks_module_editor()}</p>
        {/if}
      </div>
    </article>
  {:else}
    <p class="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-sm">
      {m.blocks_none()}
    </p>
  {/each}

  {#if offered.length > 0}
    <div class="flex flex-wrap items-center gap-2">
      <select class="{selectClass} w-56" bind:value={adding} aria-label={m.blocks_type()}>
        {#each offered as key (key)}
          <option value={key}>{blockName(key)}</option>
        {/each}
      </select>
      <Button type="button" variant="outline" onclick={add}>
        <PlusIcon class="size-4" />
        {m.blocks_add()}
      </Button>
    </div>
  {/if}
</section>
