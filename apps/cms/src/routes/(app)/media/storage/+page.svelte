<script lang="ts">
  import { enhance } from '$app/forms';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatBytes } from '#lib/media.ts';
  import { failedFields, keepValues } from '#lib/ui.ts';
  import Notice from '../../settings/notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const bad = $derived(failedFields(form, 'save'));
  const limits = [
    { name: 'image', label: m.media_limit_image() },
    { name: 'document', label: m.media_limit_document() },
    { name: 'video', label: m.media_limit_video() },
  ] as const;
</script>

<svelte:head>
  <title>{m.media_storage()} · {m.app_name()}</title>
</svelte:head>

<a
  href="/media"
  class="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-1 text-sm"
>
  <ArrowLeftIcon class="size-4" />
  {m.nav_media()}
</a>
<h1 class="mb-6 text-2xl font-semibold">{m.media_storage()}</h1>

<Notice {form} />

<div class="grid max-w-3xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.media_storage_mode()}</Card.Title>
      <Card.Description>{m.media_storage_mode_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3 text-sm">
      <div><Badge>{m.media_storage_local_only()}</Badge></div>
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt class="text-muted-foreground">{m.media_storage_objects()}</dt>
        <dd>{data.local.objects}</dd>
        <dt class="text-muted-foreground">{m.media_storage_bytes()}</dt>
        <dd>{formatBytes(data.local.bytes)}</dd>
      </dl>
    </Card.Content>
  </Card.Root>

  <form method="POST" action="?/save" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.media_cache_and_limits()}</Card.Title>
        <Card.Description>{m.media_cache_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid max-w-56 gap-2">
          <Label for="cacheDays">{m.media_cache_days()}</Label>
          <Input
            id="cacheDays"
            name="cacheDays"
            type="number"
            min={1}
            max={3650}
            required
            value={data.config.cacheDays}
            aria-invalid={bad('cacheDays')}
          />
        </div>
        <fieldset class="grid gap-2">
          <legend class="mb-2 text-sm font-medium">{m.media_limits()}</legend>
          <div class="grid gap-4 sm:grid-cols-3">
            {#each limits as limit (limit.name)}
              <div class="grid gap-2">
                <Label for="limit-{limit.name}">{limit.label}</Label>
                <Input
                  id="limit-{limit.name}"
                  name={limit.name}
                  type="number"
                  min={1}
                  max={1024}
                  required
                  value={data.config.uploadLimitsMb[limit.name]}
                  aria-invalid={bad(`uploadLimitsMb.${limit.name}`)}
                />
              </div>
            {/each}
          </div>
          <p class="text-muted-foreground text-xs">{m.media_limits_hint()}</p>
        </fieldset>
        <div><Button type="submit">{m.save()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
</div>
