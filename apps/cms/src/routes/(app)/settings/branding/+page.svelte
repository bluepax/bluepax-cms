<script lang="ts">
  import { enhance } from '$app/forms';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { mediaErrorText } from '#lib/media.ts';
  import { failedFields, keepValues } from '#lib/ui.ts';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const bad = $derived(failedFields(form, 'branding'));
  const reason = $derived((form as { reason?: string } | null)?.reason);
  const reasonFor = (field: string) =>
    bad(field) && reason ? mediaErrorText(reason, { minSize: data.iconMin }) : null;
  let themeColor = $derived(data.branding.themeColor);

  // Derived from the site icon (docs/adr/0008).
  const iconFiles = $derived(
    (data.icon?.variants ?? []).filter((v) =>
      ['favicon', 'apple-touch', 'pwa-192', 'pwa-512'].includes(v.variant),
    ),
  );
  const iconLabels: Record<string, string> = {
    favicon: 'favicon.ico (16 / 32 / 48)',
    'apple-touch': 'Apple Touch (180)',
    'pwa-192': 'PWA (192)',
    'pwa-512': 'PWA (512)',
  };
</script>

<svelte:head>
  <title>{m.settings_branding()} · {m.app_name()}</title>
</svelte:head>

<Notice {form} />

<form method="POST" action="?/branding" use:enhance={keepValues} class="max-w-3xl">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_branding()}</Card.Title>
      <Card.Description>{m.settings_branding_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6">
      <MediaPicker
        id="logo"
        name="logo"
        label={m.settings_logo()}
        hint={m.settings_logo_hint()}
        kind="image"
        value={data.logo}
        invalid={bad('logo')}
        error={reasonFor('logo')}
      />
      <div class="grid gap-3">
        <MediaPicker
          id="icon"
          name="icon"
          label={m.settings_site_icon()}
          hint={m.settings_site_icon_hint({ size: data.iconMin })}
          kind="image"
          mime="image/png"
          value={data.icon}
          invalid={bad('icon')}
          error={reasonFor('icon')}
        />
        {#if iconFiles.length > 0}
          <ul class="flex flex-wrap items-end gap-4">
            {#each iconFiles as file (file.url)}
              <li class="grid justify-items-center gap-1 text-xs">
                <img
                  src={file.url}
                  alt=""
                  width={Math.min(file.width ?? 48, 64)}
                  height={Math.min(file.height ?? 48, 64)}
                  class="rounded border"
                />
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener"
                  class="text-muted-foreground hover:underline"
                >
                  {iconLabels[file.variant]}
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <div class="grid gap-2">
        <Label for="themeColor">{m.settings_theme_color()}</Label>
        <div class="flex items-center gap-3">
          <Input
            id="themeColor"
            name="themeColor"
            class="max-w-40 font-mono"
            placeholder="#1e40af"
            pattern={'#[0-9a-fA-F]{6}'}
            bind:value={themeColor}
            aria-invalid={bad('themeColor')}
          />
          <span
            class="size-8 rounded-md border"
            style:background-color={/^#[0-9a-fA-F]{6}$/.test(themeColor)
              ? themeColor
              : 'transparent'}
            aria-hidden="true"
          ></span>
        </div>
        <p class="text-muted-foreground text-xs">{m.settings_theme_color_hint()}</p>
      </div>
      <div><Button type="submit">{m.save()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
