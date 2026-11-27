<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { errorText, selectClass } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const values = $derived(form?.values);
  const full = $derived(data.mode === 'full');
  // Editable fields start from the last submission or the defaults.
  let type = $state(untrack(() => form?.values?.type ?? 'corporate'));
  let languages = $state(
    untrack(() => form?.values?.contentLanguages ?? data.defaults.contentLanguages),
  );
  const languageList = $derived(languages.split(/[\s,，]+/).filter(Boolean));

  const fieldError = (name: string): string | null => {
    const issue = form && 'fields' in form ? form.fields?.[name] : undefined;
    if (!issue) return null;
    const friendly: Record<string, string> = {
      name: m.setup_error_name(),
      frontendBaseUrl: m.setup_error_url(),
      contentLanguages: m.setup_error_languages(),
      primaryLanguage: m.setup_error_primary(),
    };
    return friendly[name] ?? issue;
  };
  const formError = $derived(
    form && 'error' in form && form.error ? errorText(form.error) : fieldError('form'),
  );
</script>

<svelte:head>
  <title>{m.setup_title()}</title>
</svelte:head>

{#snippet hint(text: string)}
  <p class="text-muted-foreground text-xs">{text}</p>
{/snippet}
{#snippet problem(name: string)}
  {#if fieldError(name)}<p class="text-destructive text-sm">{fieldError(name)}</p>{/if}
{/snippet}

<main class="bg-muted/40 flex min-h-svh justify-center p-6">
  <Card.Root class="h-fit w-full max-w-2xl">
    <Card.Header>
      <Card.Title class="text-xl">{m.setup_title()}</Card.Title>
      <Card.Description>{full ? m.setup_intro_full() : m.setup_intro_admin()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if !data.tokenConfigured}
        <Alert.Root variant="destructive" class="mb-6">
          <Alert.Description>{m.error_install_token_missing()}</Alert.Description>
        </Alert.Root>
      {:else if formError}
        <Alert.Root variant="destructive" class="mb-6">
          <Alert.Description>{formError}</Alert.Description>
        </Alert.Root>
      {/if}

      <form method="POST" use:enhance class="grid gap-8">
        <section class="grid gap-3">
          <h2 class="font-medium">{m.setup_step_token()}</h2>
          <div class="grid gap-2">
            <Label for="token">{m.setup_token()}</Label>
            <Input id="token" name="token" type="password" autocomplete="off" required />
            {@render hint(m.setup_token_hint())}
          </div>
        </section>

        {#if full}
          <section class="grid gap-3">
            <h2 class="font-medium">{m.setup_step_type()}</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              {#each [{ value: 'corporate', label: m.setup_type_corporate(), text: m.setup_type_corporate_hint() }, { value: 'blog', label: m.setup_type_blog(), text: m.setup_type_blog_hint() }] as option (option.value)}
                <label
                  class="has-checked:border-primary has-checked:bg-accent flex cursor-pointer gap-3 rounded-lg border p-4"
                >
                  <input
                    type="radio"
                    name="type"
                    value={option.value}
                    bind:group={type}
                    class="mt-1"
                  />
                  <span class="grid gap-1">
                    <span class="font-medium">{option.label}</span>
                    <span class="text-muted-foreground text-sm">{option.text}</span>
                  </span>
                </label>
              {/each}
            </div>
          </section>

          <section class="grid gap-4">
            <h2 class="font-medium">{m.setup_step_site()}</h2>
            <div class="grid gap-2">
              <Label for="name">{m.setup_name()}</Label>
              <Input id="name" name="name" value={values?.name ?? ''} required />
              {@render problem('name')}
            </div>
            <div class="grid gap-2">
              <Label for="frontendBaseUrl">{m.setup_frontend_url()}</Label>
              <Input
                id="frontendBaseUrl"
                name="frontendBaseUrl"
                type="url"
                placeholder="https://www.example.com"
                value={values?.frontendBaseUrl ?? ''}
                required
              />
              {@render hint(m.setup_frontend_url_hint())}
              {@render problem('frontendBaseUrl')}
            </div>
            <div class="grid gap-2">
              <Label for="contentLanguages">{m.setup_content_languages()}</Label>
              <Input
                id="contentLanguages"
                name="contentLanguages"
                bind:value={languages}
                required
              />
              {@render hint(m.setup_content_languages_hint())}
              {@render problem('contentLanguages')}
            </div>
            <div class="grid gap-4 sm:grid-cols-2">
              <div class="grid gap-2">
                <Label for="primaryLanguage">{m.setup_primary_language()}</Label>
                <select
                  id="primaryLanguage"
                  name="primaryLanguage"
                  class={selectClass}
                  value={values?.primaryLanguage ?? data.defaults.primaryLanguage}
                >
                  {#each languageList as code (code)}
                    <option value={code}>{code}</option>
                  {/each}
                </select>
                {@render problem('primaryLanguage')}
              </div>
              <div class="grid gap-2">
                <Label for="adminLocale">{m.setup_admin_language()}</Label>
                <select
                  id="adminLocale"
                  name="adminLocale"
                  class={selectClass}
                  value={values?.adminLocale ?? data.defaults.adminLocale}
                >
                  <option value="zh">{m.lang_zh()}</option>
                  <option value="en">{m.lang_en()}</option>
                </select>
              </div>
            </div>
          </section>
        {/if}

        <section class="grid gap-4">
          <h2 class="font-medium">{full ? m.setup_step_admin() : m.setup_step_admin_only()}</h2>
          <div class="grid gap-2">
            <Label for="adminEmail">{m.users_email()}</Label>
            <Input
              id="adminEmail"
              name="adminEmail"
              type="email"
              autocomplete="username"
              value={values?.adminEmail ?? ''}
              required
            />
          </div>
          <div class="grid gap-2">
            <Label for="adminName">{m.users_name()}</Label>
            <Input id="adminName" name="adminName" value={values?.adminName ?? ''} required />
          </div>
          <div class="grid gap-2">
            <Label for="adminPassword">{m.users_password()}</Label>
            <Input
              id="adminPassword"
              name="adminPassword"
              type="password"
              autocomplete="new-password"
              minlength={12}
              required
            />
          </div>
          {#if !full}
            <input type="hidden" name="adminLocale" value={data.defaults.adminLocale} />
          {/if}
        </section>

        <div>
          <Button type="submit" disabled={!data.tokenConfigured}>{m.setup_submit()}</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</main>
