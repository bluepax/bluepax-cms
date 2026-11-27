<script lang="ts">
  import { enhance } from '$app/forms';
  import TranslationFields from '#lib/components/translation-fields.svelte';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedIn } from '#lib/pages.ts';
  import { postErrorText, type PostFormResult } from '#lib/posts.ts';
  import { keepValues, selectClass } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  // svelte-ignore state_referenced_locally
  let locale = $state(data.locale);
  const result = $derived(form as PostFormResult | null);
  const dir = $derived(data.languages.find((l) => l.code === locale)?.dir ?? 'ltr');
</script>

<svelte:head>
  <title>{m.posts_author_new()} · {m.app_name()}</title>
</svelte:head>

<div class="mb-6">
  <a href="/posts/authors" class="text-muted-foreground text-sm hover:underline">
    ← {m.posts_authors()}
  </a>
  <h1 class="mt-2 text-2xl font-semibold">{m.posts_author_new()}</h1>
</div>

{#if result?.error}
  <Alert.Root variant="destructive" class="mb-6 max-w-2xl" role="alert">
    <Alert.Description>{postErrorText(result.error, result.details)}</Alert.Description>
  </Alert.Root>
{/if}

<form method="POST" action="?/create" use:enhance={keepValues} class="max-w-2xl">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.posts_author_new()}</Card.Title>
      <Card.Description>{m.posts_author_new_hint()}</Card.Description>
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
      <TranslationFields
        {dir}
        lang={locale}
        reserved={[]}
        invalid={failedIn(form)}
        name="name"
        label={m.posts_author_name()}
      />
      <div class="grid gap-2">
        <Label for="userId">{m.posts_author_account()}</Label>
        <select
          id="userId"
          name="userId"
          class={selectClass}
          aria-invalid={failedIn(form)('userId')}
        >
          <option value="">{m.posts_author_account_none()}</option>
          {#each data.accounts as account (account.id)}
            <option value={account.id} disabled={account.authorId !== null}>
              {account.displayName} · {account.email}
            </option>
          {/each}
        </select>
        <p class="text-muted-foreground text-xs">{m.posts_author_account_hint()}</p>
      </div>
      <div><Button type="submit">{m.pages_create()}</Button></div>
    </Card.Content>
  </Card.Root>
</form>
