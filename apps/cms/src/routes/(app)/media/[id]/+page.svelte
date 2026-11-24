<script lang="ts">
  import { enhance } from '$app/forms';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import FileIcon from '@lucide/svelte/icons/file-text';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatBytes, mediaErrorText } from '#lib/media.ts';
  import { failedFields, formatDate, keepValues, selectClass } from '#lib/ui.ts';
  import LocalizedField from '../../settings/localized-field.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const media = $derived(data.media.view);
  const parent = $derived(data.path.at(-1) ?? null);
  const bad = $derived(failedFields(form, 'update'));
  const messages = m as unknown as Record<string, (() => string) | undefined>;

  const result = $derived(
    form as {
      saved?: string;
      failed?: string;
      error?: string;
      details?: { limitMb?: number; existingId?: string; minSize?: number };
    } | null,
  );
  const errorFor = (name: string) =>
    result?.failed === name && result.error ? mediaErrorText(result.error, result.details) : null;
  const variantLabel = (variant: string) =>
    variant.startsWith('w') ? m.media_variant_width({ width: variant.slice(1) }) : variant;
  const absolute = (url: string) => new URL(url, data.origin).href;
</script>

<svelte:head>
  <title>{media.name} · {m.nav_media()} · {m.app_name()}</title>
</svelte:head>

<a
  href={parent ? `/media?folder=${parent.id}` : '/media'}
  class="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
>
  <ArrowLeftIcon class="size-4" />
  {parent ? parent.name : m.nav_media()}
</a>
<h1 class="mb-6 text-2xl font-semibold break-all">{media.name}</h1>

{#if data.replaced}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>{m.media_replaced()}</Alert.Description>
  </Alert.Root>
{:else if result?.saved === 'update'}
  <Alert.Root class="mb-6" role="status">
    <Alert.Description>{m.saved()}</Alert.Description>
  </Alert.Root>
{:else if result?.failed === 'update'}
  <Alert.Root variant="destructive" class="mb-6" role="alert">
    <Alert.Description>{errorFor('update') ?? m.settings_invalid()}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
  <div class="grid content-start gap-6">
    <Card.Root>
      <Card.Content class="grid gap-4 pt-6">
        <div class="bg-muted flex min-h-48 items-center justify-center overflow-hidden rounded-md">
          {#if media.kind === 'image'}
            <img
              src={media.url}
              alt={media.alt[data.languages[0]?.code ?? ''] ?? ''}
              class="max-h-96 max-w-full object-contain"
            />
          {:else if media.kind === 'video'}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video src={media.url} controls preload="metadata" class="max-h-96 max-w-full"></video>
          {:else}
            <a
              href={media.url}
              target="_blank"
              rel="noopener"
              class="flex flex-col items-center gap-2 p-6 text-sm hover:underline"
            >
              <FileIcon class="text-muted-foreground size-12" />
              {m.media_open_file()}
            </a>
          {/if}
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-muted-foreground">{m.media_type()}</dt>
          <dd><code>{media.mimeType}</code></dd>
          <dt class="text-muted-foreground">{m.media_size()}</dt>
          <dd>{formatBytes(media.size)}</dd>
          {#if media.width && media.height}
            <dt class="text-muted-foreground">{m.media_dimensions()}</dt>
            <dd>{media.width} × {media.height}</dd>
          {/if}
          <dt class="text-muted-foreground">{m.media_uploaded_at()}</dt>
          <dd>
            {formatDate(data.media.createdAt)}{#if data.media.uploadedBy}
              · {data.media.uploadedBy}{/if}
          </dd>
          {#if data.media.replacedAt}
            <dt class="text-muted-foreground">{m.media_replaced_at()}</dt>
            <dd>{formatDate(data.media.replacedAt)}</dd>
          {/if}
          <dt class="text-muted-foreground">{m.media_url()}</dt>
          <dd class="min-w-0">
            <a
              href={media.url}
              target="_blank"
              rel="noopener"
              class="font-mono text-xs break-all hover:underline"
            >
              {absolute(media.url)}
            </a>
          </dd>
        </dl>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>{m.media_usages()}</Card.Title>
        <Card.Description>{m.media_usages_hint()}</Card.Description>
      </Card.Header>
      <Card.Content>
        {#if data.usages.length === 0}
          <p class="text-muted-foreground text-sm">{m.media_usages_none()}</p>
        {:else}
          <ul class="grid gap-1 text-sm">
            {#each data.usages as usage, i (i)}
              {@const label = usage.label
                ? (messages[usage.label]?.() ?? usage.fallback)
                : usage.fallback}
              <li>
                {#if usage.href}<a href={usage.href} class="hover:underline">
                    {label}
                  </a>{:else}{label}{/if}
                {#if usage.locale}<span class="text-muted-foreground font-mono text-xs">
                    · {usage.locale}
                  </span>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>

  <div class="grid content-start gap-6">
    <form method="POST" action="?/update" use:enhance={keepValues}>
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.media_details()}</Card.Title>
        </Card.Header>
        <Card.Content class="grid gap-4">
          <div class="grid items-start gap-4 sm:grid-cols-2">
            <div class="grid gap-2">
              <Label for="name">{m.media_name()}</Label>
              <Input
                id="name"
                name="name"
                value={media.name}
                required
                maxlength={200}
                aria-invalid={bad('name')}
              />
            </div>
            <div class="grid gap-2">
              <Label for="folder">{m.media_folder()}</Label>
              <select
                id="folder"
                name="folder"
                class={selectClass}
                value={data.media.folderId ?? ''}
              >
                <option value="">{m.media_all_root()}</option>
                {#each data.folders as folder (folder.id)}
                  <option value={folder.id}>{folder.path}</option>
                {/each}
              </select>
            </div>
          </div>
          <LocalizedField
            id="alt"
            name="alt"
            label={m.media_alt()}
            hint={m.media_alt_hint()}
            languages={data.languages}
            values={media.alt}
            maxlength={1000}
            invalid={bad}
          />
          <div><Button type="submit">{m.save()}</Button></div>
        </Card.Content>
      </Card.Root>
    </form>

    {#if media.variants.length > 0}
      <Card.Root>
        <Card.Header>
          <Card.Title>{m.media_variants()}</Card.Title>
          <Card.Description>{m.media_variants_hint()}</Card.Description>
        </Card.Header>
        <Card.Content>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.Head>{m.media_variant()}</Table.Head>
                <Table.Head>{m.media_type()}</Table.Head>
                <Table.Head>{m.media_dimensions()}</Table.Head>
                <Table.Head class="text-right">{m.media_size()}</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {#each media.variants as variant (variant.url)}
                <Table.Row>
                  <Table.Cell>
                    <a href={variant.url} target="_blank" rel="noopener" class="hover:underline">
                      {variantLabel(variant.variant)}
                    </a>
                  </Table.Cell>
                  <Table.Cell><code class="text-xs">{variant.contentType}</code></Table.Cell>
                  <Table.Cell>{variant.width} × {variant.height}</Table.Cell>
                  <Table.Cell class="text-right">{formatBytes(variant.size)}</Table.Cell>
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </Card.Content>
      </Card.Root>
    {/if}

    <Card.Root>
      <Card.Header>
        <Card.Title>{m.media_replace()}</Card.Title>
        <Card.Description>{m.media_replace_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-3">
        <form
          method="POST"
          action="?/replace"
          enctype="multipart/form-data"
          use:enhance
          class="flex flex-wrap items-center gap-2"
        >
          <input
            type="file"
            name="file"
            required
            accept={data.accept}
            aria-label={m.media_choose_file()}
            class="file:bg-secondary file:text-secondary-foreground min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5"
          />
          <Button type="submit" variant="outline">{m.media_replace_submit()}</Button>
        </form>
        {#if errorFor('replace')}
          <p class="text-destructive text-sm" role="alert">
            {errorFor('replace')}
            {#if result?.details?.existingId}
              <a href="/media/{result.details.existingId}" class="underline">
                {m.media_open_existing()}
              </a>
            {/if}
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title>{m.media_delete()}</Card.Title>
        <Card.Description>
          {data.usages.length > 0 ? m.media_delete_blocked() : m.media_delete_hint()}
        </Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-3">
        <form
          method="POST"
          action="?/delete"
          use:enhance={({ cancel }) => {
            if (!confirm(m.media_delete_confirm())) cancel();
          }}
        >
          <Button type="submit" variant="destructive">{m.media_delete()}</Button>
        </form>
        {#if errorFor('delete')}
          <p class="text-destructive text-sm" role="alert">{errorFor('delete')}</p>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>
