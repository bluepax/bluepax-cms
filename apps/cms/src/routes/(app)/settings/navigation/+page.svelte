<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, selectClass } from '#lib/ui.ts';
  import LocalizedField from '../localized-field.svelte';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  type Menu = 'header' | 'footer';
  type Node = (typeof data.menus.header)[number];

  const menus: { key: Menu; title: string; hint: string }[] = [
    { key: 'header', title: m.settings_nav_header(), hint: m.settings_nav_header_hint() },
    { key: 'footer', title: m.settings_nav_footer(), hint: m.settings_nav_footer_hint() },
  ];
  const label = (node: Node) =>
    node.label[data.primaryLanguage] ?? Object.values(node.label)[0] ?? '—';
  type PageOption = (typeof data.pages)[number];
  const pageTitle = (page: PageOption) =>
    page.titles[data.primaryLanguage] ?? Object.values(page.titles)[0] ?? '—';
  const linkedPage = (id: string | null) => data.pages.find((p) => p.id === id);
  /** Selected page per form, so the URL field can step aside while a page is chosen. */
  let chosenPage = $state<Record<string, string>>({});

  /** Items that can hold `self` (or a new item) without nesting deeper than allowed. */
  function parents(menu: Menu, self?: Node): Node[] {
    const nodes = data.menus[menu];
    const depth = new Map(nodes.map((n) => [n.id, n.depth]));
    const height = self
      ? Math.max(...self.subtree.map((id) => depth.get(id) ?? self.depth)) - self.depth + 1
      : 1;
    return nodes.filter((n) => !self?.subtree.includes(n.id) && n.depth + height <= data.maxDepth);
  }
  const confirmDelete = (event: Event) => {
    if (!confirm(m.settings_nav_delete_confirm())) event.preventDefault();
  };
</script>

<svelte:head>
  <title>{m.settings_navigation()} · {m.app_name()}</title>
</svelte:head>

{#snippet itemFields(menu: Menu, node: Node | undefined, invalid: (field: string) => boolean)}
  {@const key = node?.id ?? `new-${menu}`}
  <LocalizedField
    id="label-{key}"
    name="label"
    label={m.settings_nav_label()}
    languages={data.languages}
    primary={data.primaryLanguage}
    values={node?.label}
    maxlength={100}
    {invalid}
  />
  {@const pageId = chosenPage[key] ?? node?.pageId ?? ''}
  <div class="grid gap-2">
    <Label for="page-{key}">{m.settings_nav_page()}</Label>
    <select
      id="page-{key}"
      name="pageId"
      class={selectClass}
      value={pageId}
      onchange={(event) => (chosenPage[key] = event.currentTarget.value)}
      aria-invalid={invalid('pageId')}
    >
      <option value="">{m.settings_nav_page_none()}</option>
      {#each data.pages as option (option.id)}
        <option value={option.id}>
          {pageTitle(option)}{option.isHome ? ` (${m.pages_home()})` : ''} · {Object.keys(
            option.titles,
          ).join(', ')}
        </option>
      {/each}
    </select>
    <p class="text-muted-foreground text-xs">{m.settings_nav_page_hint()}</p>
  </div>
  {#if !pageId}
    <div class="grid gap-2">
      <Label for="url-{key}">{m.settings_nav_url()}</Label>
      <Input id="url-{key}" name="url" value={node?.url ?? ''} aria-invalid={invalid('url')} />
      <p class="text-muted-foreground text-xs">{m.settings_nav_url_hint()}</p>
    </div>
  {/if}
  <div class="grid items-start gap-4 sm:grid-cols-3">
    <div class="grid gap-2 sm:col-span-2">
      <Label for="parent-{key}">{m.settings_nav_parent()}</Label>
      <select
        id="parent-{key}"
        name="parentId"
        class={selectClass}
        value={node?.parentId ?? ''}
        aria-invalid={invalid('parentId')}
      >
        <option value="">{m.settings_nav_top()}</option>
        {#each parents(menu, node) as parent (parent.id)}
          <option value={parent.id}>{'— '.repeat(parent.depth - 1)}{label(parent)}</option>
        {/each}
      </select>
    </div>
    <div class="grid gap-2">
      <Label for="sortOrder-{key}">{m.settings_sort_order()}</Label>
      <Input
        id="sortOrder-{key}"
        name="sortOrder"
        type="number"
        step="1"
        placeholder="0"
        value={node ? String(node.sortOrder) : ''}
      />
    </div>
  </div>
  <label class="flex items-center gap-2 text-sm">
    <input type="checkbox" name="newTab" checked={node?.newTab ?? false} />
    {m.settings_nav_new_tab()}
  </label>
{/snippet}

<Notice
  {form}
  texts={{ 'nav:new:header': m.settings_nav_added(), 'nav:new:footer': m.settings_nav_added() }}
/>

<div class="grid max-w-3xl gap-6">
  {#each menus as menu (menu.key)}
    <Card.Root>
      <Card.Header>
        <Card.Title>{menu.title}</Card.Title>
        <Card.Description>{menu.hint}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-2">
        {#each data.menus[menu.key] as node (node.id)}
          <details
            class="rounded-md border"
            style:margin-inline-start="{(node.depth - 1) * 1.5}rem"
          >
            <summary class="cursor-pointer px-4 py-2 text-sm">
              <span class="font-medium">{label(node)}</span>
              <span class="text-muted-foreground">
                {#if linkedPage(node.pageId)}
                  {m.settings_nav_page_link({ title: pageTitle(linkedPage(node.pageId)!) })}
                {:else}
                  {node.url || m.settings_nav_heading()}
                {/if}{node.newTab ? ' ↗' : ''}
              </span>
            </summary>
            <form
              method="POST"
              action="?/update"
              use:enhance={keepValues}
              class="grid gap-4 border-t p-4"
            >
              <input type="hidden" name="item" value={node.id} />
              {@render itemFields(menu.key, node, failedFields(form, `nav:${node.id}`))}
              <div class="flex gap-2">
                <Button type="submit" size="sm">{m.save()}</Button>
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  formaction="?/delete"
                  formnovalidate
                  onclick={confirmDelete}
                >
                  {m.settings_remove()}
                </Button>
              </div>
            </form>
          </details>
        {:else}
          <p class="text-muted-foreground text-sm">{m.settings_nav_none()}</p>
        {/each}

        <details
          class="mt-2 rounded-md border border-dashed"
          open={form?.failed === `nav:new:${menu.key}`}
        >
          <summary class="cursor-pointer px-4 py-2 text-sm font-medium">
            {m.settings_nav_add()}
          </summary>
          <form method="POST" action="?/create" use:enhance class="grid gap-4 border-t p-4">
            <input type="hidden" name="menu" value={menu.key} />
            {@render itemFields(menu.key, undefined, failedFields(form, `nav:new:${menu.key}`))}
            <div><Button type="submit" size="sm">{m.settings_nav_add()}</Button></div>
          </form>
        </details>
      </Card.Content>
    </Card.Root>
  {/each}

  <form method="POST" action="?/footer" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_footer_text()}</Card.Title>
        <Card.Description>{m.settings_footer_text_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <LocalizedField
          id="footer-text"
          name="text"
          label={m.settings_footer_text()}
          languages={data.languages}
          values={data.footerText}
          multiline
          maxlength={1000}
          invalid={failedFields(form, 'footer')}
        />
        <div><Button type="submit">{m.save()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
</div>
