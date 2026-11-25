<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn, pageErrorText, type PageFormResult } from '#lib/pages.ts';
  import { keepValues, selectClass } from '#lib/ui.ts';
  import TranslationFields from '../translation-fields.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // svelte-ignore state_referenced_locally
  let locale = $state(data.locale);
  const result = $derived(form as PageFormResult | null);
  const dir = $derived(data.languages.find((l) => l.code === locale)?.dir ?? 'ltr');
</script>

<svelte:head>
  <title>{m.pages_new()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-6">
  <a href="/pages" class="text-muted-foreground text-sm hover:underline">← {m.nav_pages()}</a>
  <h1 class="mt-2 text-2xl font-semibold">{m.pages_new()}</h1>
</div>

{#if result?.error}
  <Alert.Root variant="destructive" class="mb-6 max-w-2xl" role="alert">
    <Alert.Description>{pageErrorText(result.error, result.details)}</Alert.Description>
  </Alert.Root>
{/if}

<form method="POST" action="?/create" use:enhance={keepValues} class="max-w-2xl">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.pages_new()}</Card.Title>
      <Card.Description>{m.pages_new_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <div class="grid gap-2">
        <Label for="locale">{m.pages_language()}</Label>
        <select id="locale" name="locale" class={selectClass} bind:value={locale}>
          {#each data.languages as language (language.code)}
            <option value={language.code}>{language.code}</option>
          {/each}
        </select>
      </div>
      <TranslationFields {dir} lang={locale} reserved={data.reserved} invalid={failedIn(form)} />
      <div><Button type="submit">{m.pages_create()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
