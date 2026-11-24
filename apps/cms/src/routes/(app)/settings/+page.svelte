<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, selectClass, textareaClass } from '#lib/ui.ts';
  import Notice from './notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const site = $derived(data.site);
  const bad = $derived(failedFields(form, 'general'));
  const badBranding = $derived(failedFields(form, 'branding'));
  let themeColor = $derived(data.branding.themeColor);
</script>

<svelte:head>
  <title>{m.settings_general()} · {m.app_name()}</title>
</svelte:head>

{#snippet hint(text: string)}
  <p class="text-muted-foreground text-xs">{text}</p>
{/snippet}

<Notice {form} />

<div class="grid max-w-3xl gap-6">
  <form method="POST" action="?/general" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_site_title()}</Card.Title>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid items-start gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="type">{m.settings_type()}</Label>
            <select id="type" name="type" class={selectClass} value={site.type}>
              <option value="corporate">{m.setup_type_corporate()}</option>
              <option value="blog">{m.setup_type_blog()}</option>
            </select>
            {@render hint(m.settings_type_hint())}
          </div>
          <div class="grid gap-2">
            <Label for="timezone">{m.settings_timezone()}</Label>
            <select
              id="timezone"
              name="timezone"
              class={selectClass}
              value={site.timezone}
              aria-invalid={bad('timezone')}
            >
              {#each data.timeZones as zone (zone)}
                <option value={zone}>{zone}</option>
              {/each}
            </select>
            {@render hint(m.settings_timezone_hint())}
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="name">{m.setup_name()}</Label>
          <Input id="name" name="name" value={site.name} required aria-invalid={bad('name')} />
        </div>
        <div class="grid gap-2">
          <Label for="brandTerms">{m.settings_brand_terms()}</Label>
          <textarea
            id="brandTerms"
            name="brandTerms"
            class={textareaClass}
            aria-invalid={bad('brandTerms')}
            value={site.brandTerms.join('\n')}></textarea>
          {@render hint(m.settings_brand_terms_hint())}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="mt-6">
      <Card.Header>
        <Card.Title>{m.settings_publisher()}</Card.Title>
        <Card.Description>{m.settings_publisher_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid items-start gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="publisher-type">{m.settings_publisher_type()}</Label>
            <select
              id="publisher-type"
              name="publisher.type"
              class={selectClass}
              value={site.publisher.type}
            >
              <option value="organization">{m.settings_publisher_organization()}</option>
              <option value="person">{m.settings_publisher_person()}</option>
            </select>
          </div>
          <div class="grid gap-2">
            <Label for="publisher-name">{m.settings_publisher_name()}</Label>
            <Input
              id="publisher-name"
              name="publisher.name"
              value={site.publisher.name}
              placeholder={site.name}
              aria-invalid={bad('publisher.name')}
            />
            {@render hint(m.settings_publisher_name_hint())}
          </div>
        </div>
        <div class="grid gap-2">
          <Label for="publisher-sameAs">{m.settings_publisher_same_as()}</Label>
          <textarea
            id="publisher-sameAs"
            name="publisher.sameAs"
            class={textareaClass}
            placeholder="https://"
            aria-invalid={bad('publisher.sameAs')}
            value={site.publisher.sameAs.join('\n')}></textarea>
          {@render hint(m.settings_lines_url_hint())}
          {#if bad('publisher.sameAs')}
            <p class="text-destructive text-sm">{m.settings_field_url()}</p>
          {/if}
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>

  <form method="POST" action="?/branding" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_branding()}</Card.Title>
        <Card.Description>{m.settings_branding_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
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
              aria-invalid={badBranding('themeColor')}
            />
            <span
              class="size-8 rounded-md border"
              style:background-color={/^#[0-9a-fA-F]{6}$/.test(themeColor)
                ? themeColor
                : 'transparent'}
              aria-hidden="true"
            ></span>
          </div>
          {@render hint(m.settings_theme_color_hint())}
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
</div>
