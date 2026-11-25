<script lang="ts">
  import { slugify } from '@bluepax/core';
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';

  // Title (or name) and slug of a new record or language version. The slug is suggested from a
  // Latin title; for other scripts the editor types it (lowercase Latin, chapter 6).
  let {
    dir,
    lang,
    reserved,
    invalid,
    name = 'title',
    label = m.pages_title(),
    initialSlug = '',
  }: {
    dir: 'ltr' | 'rtl';
    lang: string;
    reserved: string[];
    invalid: (field: string) => boolean;
    /** Form field of the title, e.g. `name` for an author. */
    name?: string;
    label?: string;
    /** A slug to start from, e.g. the one of another language. */
    initialSlug?: string;
  } = $props();

  let title = $state('');
  // svelte-ignore state_referenced_locally
  let slug = $state(initialSlug);
  // svelte-ignore state_referenced_locally
  let edited = $state(initialSlug !== '');

  function onTitle() {
    if (!edited) slug = slugify(title);
  }
</script>

<div class="grid gap-2">
  <Label for={name}>{label}</Label>
  <Input
    id={name}
    {name}
    {dir}
    {lang}
    required
    maxlength={200}
    bind:value={title}
    oninput={onTitle}
    aria-invalid={invalid(name)}
  />
</div>
<div class="grid gap-2">
  <Label for="slug">{m.pages_slug()}</Label>
  <div class="flex gap-2">
    <Input
      id="slug"
      name="slug"
      dir="ltr"
      required
      maxlength={100}
      pattern="[a-z0-9]+(-[a-z0-9]+)*"
      class="font-mono"
      bind:value={slug}
      oninput={() => (edited = true)}
      aria-invalid={invalid('slug')}
      aria-describedby="slug-hint"
    />
    <Button
      type="button"
      variant="outline"
      onclick={() => {
        slug = slugify(title);
        edited = false;
      }}
    >
      {m.pages_slug_generate()}
    </Button>
  </div>
  <p id="slug-hint" class="text-muted-foreground text-xs">
    {m.pages_slug_hint()}
    {#if reserved.length > 0}
      {m.pages_slug_reserved_list({ slugs: reserved.join(', ') })}
    {/if}
  </p>
</div>
