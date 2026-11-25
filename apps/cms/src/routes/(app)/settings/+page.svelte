<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import MediaPicker from '#lib/components/media-picker.svelte';
  import { mediaErrorText } from '#lib/media.ts';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, selectClass, textareaClass } from '#lib/ui.ts';
  import Notice from './notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const site = $derived(data.site);
  const bad = $derived(failedFields(form, 'general'));
  const reason = $derived((form as { reason?: string } | null)?.reason);
  // The image field follows the publisher type; fallbacks in spec ch.2 "发布者" (docs/adr/0008).
  let publisherType = $derived(site.publisher.type);
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
              bind:value={publisherType}
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
          <Label for="publisher-author">{m.settings_publisher_author()}</Label>
          <select
            id="publisher-author"
            name="publisher.authorId"
            class={selectClass}
            value={data.publisherAuthor ?? ''}
            aria-invalid={bad('publisher.authorId')}
          >
            <option value="">{m.settings_publisher_author_none()}</option>
            {#each data.authors as author (author.id)}
              <option value={author.id}>
                {author.names[data.primaryLanguage] ?? Object.values(author.names)[0] ?? '—'}
              </option>
            {/each}
          </select>
          {@render hint(m.settings_publisher_author_hint())}
        </div>
        <MediaPicker
          id="publisher-image"
          name="publisher.image"
          label={publisherType === 'person'
            ? m.settings_publisher_avatar()
            : m.settings_publisher_logo()}
          hint={publisherType === 'person'
            ? m.settings_publisher_avatar_hint()
            : m.settings_publisher_logo_hint()}
          kind="image"
          value={data.publisherImage}
          invalid={bad('image')}
          error={bad('image') && reason ? mediaErrorText(reason) : null}
        />
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
</div>
