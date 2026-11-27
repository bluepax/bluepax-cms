<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, selectClass } from '#lib/ui.ts';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const bad = $derived(failedFields(form, 'languages'));

  let nextKey = 0;
  const rowsFromData = () =>
    data.languages.map((l) => ({ key: nextKey++, code: l.code, dir: l.dir as string }));
  let rows = $state(untrack(rowsFromData));
  let primary = $state(untrack(() => data.primaryLanguage));
  // A successful save reloads the data; show what was stored (codes in canonical form).
  $effect(() => {
    rows = rowsFromData();
    primary = data.primaryLanguage;
  });
  const codes = $derived([...new Set(rows.map((r) => r.code.trim()).filter(Boolean))]);
</script>

<svelte:head>
  <title>{m.settings_languages()} · {m.app_name()}</title>
</svelte:head>

<Notice {form} />

<form method="POST" use:enhance={keepValues} class="max-w-3xl">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_content_languages()}</Card.Title>
      <Card.Description>{m.settings_content_languages_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid gap-2">
        {#each rows as row, i (row.key)}
          <div class="flex items-center gap-2">
            <Input
              name="code"
              class="max-w-40 font-mono"
              placeholder="zh-CN"
              aria-label={m.settings_language_code()}
              bind:value={row.code}
              required
              aria-invalid={bad(`content.${i}`) || bad('content')}
            />
            <select
              name="dir"
              class="{selectClass} max-w-48"
              aria-label={m.settings_language_dir()}
              bind:value={row.dir}
            >
              <option value="">{m.settings_dir_auto()}</option>
              <option value="ltr">{m.settings_dir_ltr()}</option>
              <option value="rtl">{m.settings_dir_rtl()}</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={m.settings_remove()}
              disabled={rows.length === 1}
              onclick={() => rows.splice(i, 1)}
            >
              <TrashIcon class="size-4" />
            </Button>
          </div>
        {/each}
        {#if bad('content')}
          <p class="text-destructive text-sm">{m.setup_error_languages()}</p>
        {/if}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onclick={() => rows.push({ key: nextKey++, code: '', dir: '' })}
          >
            <PlusIcon class="size-4" />
            {m.settings_language_add()}
          </Button>
        </div>
      </div>

      <div class="grid items-start gap-4 sm:grid-cols-2">
        <div class="grid gap-2">
          <Label for="primary">{m.setup_primary_language()}</Label>
          <select
            id="primary"
            name="primary"
            class={selectClass}
            bind:value={primary}
            aria-invalid={bad('primary')}
          >
            {#each codes as code (code)}
              <option value={code}>{code}</option>
            {/each}
          </select>
          {#if bad('primary')}
            <p class="text-destructive text-sm">{m.setup_error_primary()}</p>
          {/if}
        </div>
        <div class="grid gap-2">
          <Label for="admin">{m.settings_admin_language()}</Label>
          <select id="admin" name="admin" class={selectClass} value={data.admin}>
            <option value="zh">{m.lang_zh()}</option>
            <option value="en">{m.lang_en()}</option>
          </select>
          <p class="text-muted-foreground text-xs">{m.settings_admin_language_hint()}</p>
        </div>
      </div>
      <div><Button type="submit">{m.save()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
