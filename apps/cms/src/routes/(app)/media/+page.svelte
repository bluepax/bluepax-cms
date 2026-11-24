<script lang="ts">
  import { deserialize, enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import FileIcon from '@lucide/svelte/icons/file-text';
  import FolderIcon from '@lucide/svelte/icons/folder';
  import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
  import HardDriveIcon from '@lucide/svelte/icons/hard-drive';
  import UploadIcon from '@lucide/svelte/icons/upload';
  import VideoIcon from '@lucide/svelte/icons/video';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatBytes, mediaErrorText } from '#lib/media.ts';
  import { keepValues } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  interface UploadResult {
    name: string;
    id?: string;
    error?: string;
    details?: { limitMb?: number; existingId?: string; minSize?: number };
  }

  let uploading = $state<{ done: number; total: number } | null>(null);
  let results = $state<UploadResult[]>([]);
  let fileInput = $state<HTMLInputElement>();

  const folderHref = (id: string | null) => (id ? `/media?folder=${id}` : '/media');
  const current = $derived(data.path.at(-1) ?? null);
  const lastPage = $derived(Math.max(Math.ceil(data.list.total / data.list.pageSize), 1));
  const pageHref = (n: number) =>
    `/media?${new URLSearchParams({ ...Object.fromEntries(page.url.searchParams), page: String(n) })}`;

  /** Rough kind of a file before upload, only to warn early; the server checks the content. */
  function limitFor(file: File): number {
    if (file.type.startsWith('image/')) return data.limits.image;
    if (file.type.startsWith('video/')) return data.limits.video;
    return data.limits.document;
  }

  // One request per file keeps every request within the limit of its kind and shows progress.
  async function upload(event: SubmitEvent) {
    event.preventDefault();
    const files = [...(fileInput?.files ?? [])];
    if (files.length === 0) return;
    results = [];
    uploading = { done: 0, total: files.length };
    for (const file of files) {
      if (file.size > limitFor(file) * 1024 * 1024) {
        results.push({ name: file.name, error: 'too_large', details: { limitMb: limitFor(file) } });
      } else {
        const body = new FormData();
        body.set('folder', data.folderId ?? '');
        body.set('file', file);
        try {
          const response = await fetch(`${page.url.pathname}?/upload`, {
            method: 'POST',
            body,
            headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
          });
          const result = deserialize(await response.text());
          if (result.type === 'success') {
            const list = (result.data as { results?: UploadResult[] } | undefined)?.results ?? [];
            results.push(...list);
          } else if (result.type === 'failure') {
            const failed = result.data as { error?: string; details?: UploadResult['details'] };
            results.push({
              name: file.name,
              error: failed.error ?? 'upload_failed',
              ...(failed.details && { details: failed.details }),
            });
          } else {
            results.push({ name: file.name, error: 'upload_failed' });
          }
        } catch {
          results.push({ name: file.name, error: 'upload_failed' });
        }
      }
      uploading = { done: uploading.done + 1, total: files.length };
    }
    if (fileInput) fileInput.value = '';
    uploading = null;
    await invalidateAll();
  }

  const formError = $derived.by(() => {
    const result = form as {
      failed?: string;
      error?: string;
      details?: UploadResult['details'];
    } | null;
    return result?.error
      ? { form: result.failed, text: mediaErrorText(result.error, result.details) }
      : null;
  });
</script>

<svelte:head>
  <title>{m.nav_media()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
  <h1 class="text-2xl font-semibold">{m.nav_media()}</h1>
  {#if data.canStorage}
    <a href="/media/storage" class={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <HardDriveIcon class="size-4" />
      {m.media_storage()}
    </a>
  {/if}
</div>

<nav
  class="text-muted-foreground mb-4 flex flex-wrap items-center gap-1 text-sm"
  aria-label={m.media_folders()}
>
  <a href="/media" class="hover:text-foreground" class:text-foreground={!current}>
    {m.media_all_root()}
  </a>
  {#each data.path as folder (folder.id)}
    <span aria-hidden="true">/</span>
    <a
      href={folderHref(folder.id)}
      class="hover:text-foreground"
      class:text-foreground={folder.id === current?.id}
    >
      {folder.name}
    </a>
  {/each}
</nav>

{#if data.deleted}
  <Alert.Root class="mb-4" role="status">
    <Alert.Description>
      {data.deleted === 'folder' ? m.media_folder_deleted() : m.media_deleted()}
    </Alert.Description>
  </Alert.Root>
{/if}
{#if formError}
  <Alert.Root variant="destructive" class="mb-4" role="alert">
    <Alert.Description>{formError.text}</Alert.Description>
  </Alert.Root>
{/if}

<div class="mb-6 grid gap-4 lg:grid-cols-2">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.media_upload()}</Card.Title>
      <Card.Description>
        {m.media_upload_hint({
          image: data.limits.image,
          document: data.limits.document,
          video: data.limits.video,
        })}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form
        method="POST"
        action="?/upload"
        enctype="multipart/form-data"
        onsubmit={upload}
        class="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="folder" value={data.folderId ?? ''} />
        <input
          bind:this={fileInput}
          type="file"
          name="file"
          multiple
          required
          accept={data.accept}
          aria-label={m.media_choose_files()}
          class="file:bg-secondary file:text-secondary-foreground min-w-0 flex-1 text-sm file:mr-3 file:rounded-md file:border-0 file:px-3 file:py-1.5"
        />
        <Button type="submit" disabled={uploading !== null}>
          <UploadIcon class="size-4" />
          {uploading
            ? m.media_uploading({ done: uploading.done, total: uploading.total })
            : m.media_upload()}
        </Button>
      </form>
      {#if results.length > 0}
        <ul class="mt-4 grid gap-1 text-sm" aria-live="polite">
          {#each results as result, i (i)}
            <li class="flex flex-wrap gap-x-2">
              <span class="font-medium break-all">{result.name}</span>
              {#if result.id}
                <a
                  href="/media/{result.id}"
                  class="text-green-700 hover:underline dark:text-green-400"
                >
                  {m.media_uploaded()}
                </a>
              {:else}
                <span class="text-destructive">
                  {mediaErrorText(result.error ?? 'upload_failed', result.details)}
                </span>
                {#if result.details?.existingId}
                  <a href="/media/{result.details.existingId}" class="hover:underline">
                    {m.media_open_existing()}
                  </a>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{current ? current.name : m.media_folders()}</Card.Title>
      <Card.Description>{m.media_folders_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#if data.canNest}
        <form method="POST" action="?/createFolder" use:enhance class="flex gap-2">
          <input type="hidden" name="parent" value={data.folderId ?? ''} />
          <Input
            name="name"
            required
            maxlength={100}
            placeholder={m.media_folder_name()}
            aria-label={m.media_folder_name()}
          />
          <Button type="submit" variant="outline">
            <FolderPlusIcon class="size-4" />
            {m.media_folder_new()}
          </Button>
        </form>
      {/if}
      {#if current}
        {#key current.id}
          <form method="POST" action="?/renameFolder" use:enhance={keepValues} class="flex gap-2">
            <input type="hidden" name="id" value={current.id} />
            <Input
              name="name"
              required
              maxlength={100}
              value={current.name}
              aria-label={m.media_folder_name()}
            />
            <Button type="submit" variant="outline">{m.media_folder_rename()}</Button>
          </form>
        {/key}
        <form method="POST" action="?/deleteFolder" use:enhance>
          <input type="hidden" name="id" value={current.id} />
          <Button type="submit" variant="ghost" class="text-destructive px-0">
            {m.media_folder_delete()}
          </Button>
        </form>
      {/if}
    </Card.Content>
  </Card.Root>
</div>

<form method="GET" action="/media" class="mb-4 flex max-w-md gap-2">
  {#if data.folderId && !data.query}<input type="hidden" name="folder" value={data.folderId} />{/if}
  <Input
    name="q"
    type="search"
    value={data.query}
    placeholder={m.media_search()}
    aria-label={m.media_search()}
  />
  <Button type="submit" variant="outline">{m.media_search_submit()}</Button>
</form>

{#if data.query}
  <p class="text-muted-foreground mb-4 text-sm">
    {m.media_search_results({ query: data.query, count: data.list.total })}
    <a href={folderHref(data.folderId)} class="hover:underline">{m.media_search_clear()}</a>
  </p>
{:else if data.children.length > 0}
  <ul class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
    {#each data.children as folder (folder.id)}
      <li>
        <a
          href={folderHref(folder.id)}
          class="hover:bg-accent flex items-center gap-2 rounded-md border p-3 text-sm"
        >
          <FolderIcon class="text-muted-foreground size-5 shrink-0" />
          <span class="truncate">{folder.name}</span>
        </a>
      </li>
    {/each}
  </ul>
{/if}

{#if data.list.items.length === 0}
  <p class="text-muted-foreground text-sm">
    {data.query ? m.media_search_none() : m.media_empty()}
  </p>
{:else}
  <ul class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
    {#each data.list.items as item (item.id)}
      <li>
        <a href="/media/{item.id}" class="group block overflow-hidden rounded-md border">
          <div class="bg-muted flex aspect-square items-center justify-center">
            {#if item.thumbUrl}
              <!-- The name below labels the link, so the preview is decorative. -->
              <img
                src={item.thumbUrl}
                alt=""
                loading="lazy"
                class="max-h-full max-w-full object-contain"
              />
            {:else if item.kind === 'video'}
              <VideoIcon class="text-muted-foreground size-10" />
            {:else}
              <FileIcon class="text-muted-foreground size-10" />
            {/if}
          </div>
          <div class="p-2 text-xs">
            <p class="truncate font-medium group-hover:underline" title={item.name}>{item.name}</p>
            <p class="text-muted-foreground">
              {formatBytes(item.size)}{#if item.width && item.height}
                · {item.width}×{item.height}{/if}
            </p>
          </div>
        </a>
      </li>
    {/each}
  </ul>
  {#if lastPage > 1}
    <nav class="mt-6 flex items-center gap-3 text-sm">
      {#if data.list.page > 1}<a href={pageHref(data.list.page - 1)} class="hover:underline">
          {m.media_page_prev()}
        </a>{/if}
      <span class="text-muted-foreground">
        {m.media_page({ page: data.list.page, pages: lastPage })}
      </span>
      {#if data.list.page < lastPage}<a href={pageHref(data.list.page + 1)} class="hover:underline">
          {m.media_page_next()}
        </a>{/if}
    </nav>
  {/if}
{/if}
