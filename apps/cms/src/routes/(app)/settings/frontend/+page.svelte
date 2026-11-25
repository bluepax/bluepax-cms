<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, textareaClass } from '#lib/ui.ts';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const invalid = $derived(failedFields(form, 'frontend'));
  interface InUse {
    pageId: string;
    locale: string;
    slug: string;
    title: string;
  }
  /** Pages that use a slug that was to become reserved. */
  const inUse = $derived.by(() => {
    const result = form as { reason?: string; details?: { pages?: InUse[] } } | null;
    return result?.reason === 'slug_in_use' ? (result.details?.pages ?? []) : [];
  });
</script>

<svelte:head>
  <title>{m.settings_frontend()} · {m.app_name()}</title>
</svelte:head>

<Notice {form} />

{#if inUse.length > 0}
  <Alert.Root variant="destructive" class="mb-6 max-w-3xl" role="alert">
    <Alert.Title>{m.settings_frontend_slug_in_use()}</Alert.Title>
    <Alert.Description>
      <ul class="list-disc ps-5">
        {#each inUse as page (`${page.pageId}:${page.locale}`)}
          <li>
            <a
              href="/pages/{page.pageId}?locale={encodeURIComponent(page.locale)}"
              class="underline"
            >
              {page.title}
            </a>
            <span class="font-mono text-xs">· {page.locale} · {page.slug}</span>
          </li>
        {/each}
      </ul>
    </Alert.Description>
  </Alert.Root>
{/if}

<form method="POST" use:enhance={keepValues} class="max-w-3xl">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_frontend()}</Card.Title>
      <Card.Description>{m.settings_frontend_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid gap-2">
        <span class="text-sm font-medium">{m.settings_frontend_base_url()}</span>
        <p class="font-mono text-sm" dir="ltr">{data.frontend.baseUrl}</p>
      </div>
      <div class="grid gap-2">
        <Label for="reservedSlugs">{m.settings_frontend_reserved()}</Label>
        <textarea
          id="reservedSlugs"
          name="reservedSlugs"
          class="{textareaClass} min-h-32 font-mono"
          dir="ltr"
          aria-invalid={invalid('reservedSlugs')}
          value={data.frontend.reservedSlugs.join('\n')}></textarea>
        <p class="text-muted-foreground text-xs">{m.settings_frontend_reserved_hint()}</p>
      </div>
      <div class="grid gap-2">
        <span class="text-sm font-medium">{m.settings_frontend_route_segments()}</span>
        <p class="font-mono text-sm" dir="ltr">{data.routeSegments.join(', ')}</p>
        <p class="text-muted-foreground text-xs">{m.settings_frontend_route_segments_hint()}</p>
      </div>
      <div><Button type="submit">{m.save()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
