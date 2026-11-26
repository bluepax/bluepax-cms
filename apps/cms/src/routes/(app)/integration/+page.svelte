<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, formatDate, keepValues, selectClass } from '#lib/ui.ts';
  import ApiConsole from './api-console.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  type Result = { saved?: string; failed?: string; reason?: string; result?: unknown } | null;
  const result = $derived(form as Result);
  const issued = $derived(
    result?.saved === 'issue' ? (result.result as { token: string }).token : null,
  );
  const secret = $derived(
    result?.saved === 'preview' ? (result.result as { secret: string }).secret : null,
  );
  const badFrontend = $derived(failedFields(form, 'frontend'));
  const badIssue = $derived(failedFields(form, 'issue'));

  const notice = $derived.by(() => {
    if (!result) return null;
    if (result.failed === 'issue' && result.reason === 'too_many_tokens') {
      return { error: true, text: m.api_token_too_many() };
    }
    if (result.failed) return { error: true, text: m.settings_invalid() };
    const texts: Record<string, string> = {
      frontend: m.saved(),
      revoke: m.api_token_revoked(),
    };
    return result.saved && texts[result.saved]
      ? { error: false, text: texts[result.saved]! }
      : null;
  });

  const scopeLabel = (scope: string) =>
    scope === 'delivery:read' ? m.api_scope_read() : m.api_scope_events();
  const statusLabel = (status: string) =>
    status === 'active'
      ? m.api_token_active()
      : status === 'expired'
        ? m.api_token_expired()
        : m.api_token_revoked_status();

  const confirmRevoke = (event: SubmitEvent) => {
    if (!confirm(m.api_token_revoke_confirm())) event.preventDefault();
  };
  const confirmRotate = (event: SubmitEvent) => {
    if (data.frontend.previewSecretSet && !confirm(m.api_preview_rotate_confirm())) {
      event.preventDefault();
    }
  };

  let copied = $state<string | null>(null);
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    copied = value;
  }
</script>

<svelte:head>
  <title>{m.nav_api()} · {m.app_name()}</title>
</svelte:head>

<h1 class="mb-2 text-2xl font-semibold">{m.nav_api()}</h1>
<p class="text-muted-foreground mb-6 max-w-3xl text-sm">{m.api_intro()}</p>

{#if notice}
  <Alert.Root
    variant={notice.error ? 'destructive' : 'default'}
    class="mb-6 max-w-3xl"
    role="status"
  >
    <Alert.Description>{notice.text}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid max-w-3xl gap-6">
  <form method="POST" action="?/frontend" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.api_frontend()}</Card.Title>
        <Card.Description>{m.api_frontend_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-2">
        <Label for="baseUrl">{m.settings_frontend_base_url()}</Label>
        <Input
          id="baseUrl"
          name="baseUrl"
          type="url"
          required
          value={data.frontend.baseUrl}
          aria-invalid={badFrontend('baseUrl')}
        />
      </Card.Content>
      <Card.Footer>
        <Button type="submit">{m.save()}</Button>
      </Card.Footer>
    </Card.Root>
  </form>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.api_tokens()}</Card.Title>
      <Card.Description>{m.api_tokens_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-6">
      {#if issued}
        <Alert.Root role="status">
          <Alert.Title>{m.api_token_issued()}</Alert.Title>
          <Alert.Description class="grid gap-2">
            <code
              class="bg-muted rounded px-2 py-1 font-mono text-xs break-all"
              data-testid="issued-token"
            >
              {issued}
            </code>
            <span>{m.api_shown_once()}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="w-fit"
              onclick={() => copy(issued)}
            >
              {copied === issued ? m.api_copied() : m.api_copy()}
            </Button>
          </Alert.Description>
        </Alert.Root>
      {/if}

      {#if data.tokens.length === 0}
        <p class="text-muted-foreground text-sm">{m.api_tokens_none()}</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.api_token_name()}</Table.Head>
              <Table.Head>{m.api_token_scopes()}</Table.Head>
              <Table.Head>{m.api_token_dates()}</Table.Head>
              <Table.Head>{m.api_token_status()}</Table.Head>
              <Table.Head></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.tokens as token (token.id)}
              <Table.Row>
                <Table.Cell>
                  <div class="font-medium">{token.name}</div>
                  <code class="text-muted-foreground font-mono text-xs">{token.prefix}…</code>
                </Table.Cell>
                <Table.Cell>
                  <div class="flex flex-wrap gap-1">
                    {#each token.scopes as scope (scope)}
                      <Badge variant="outline" title={scope}>{scopeLabel(scope)}</Badge>
                    {/each}
                  </div>
                </Table.Cell>
                <Table.Cell class="text-muted-foreground text-xs">
                  <div>
                    {m.api_token_created({
                      date: formatDate(token.createdAt),
                      by: token.createdBy ?? '—',
                    })}
                  </div>
                  <div>
                    {token.lastUsedAt
                      ? m.api_token_last_used({ date: formatDate(token.lastUsedAt) })
                      : m.api_token_never_used()}
                  </div>
                  <div>
                    {token.expiresAt
                      ? m.api_token_expires({ date: formatDate(token.expiresAt) })
                      : m.api_token_no_expiry()}
                  </div>
                </Table.Cell>
                <Table.Cell>
                  <Badge variant={token.status === 'active' ? 'secondary' : 'outline'}>
                    {statusLabel(token.status)}
                  </Badge>
                </Table.Cell>
                <Table.Cell class="text-right">
                  {#if token.status === 'active'}
                    <form method="POST" action="?/revoke" use:enhance onsubmit={confirmRevoke}>
                      <input type="hidden" name="id" value={token.id} />
                      <Button type="submit" variant="outline" size="sm">
                        {m.api_token_revoke()}
                      </Button>
                    </form>
                  {/if}
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}

      <form method="POST" action="?/issue" use:enhance class="grid gap-4 border-t pt-4">
        <h3 class="text-sm font-medium">{m.api_token_new()}</h3>
        <div class="grid items-start gap-4 sm:grid-cols-[2fr_1fr]">
          <div class="grid gap-2">
            <Label for="name">{m.api_token_name()}</Label>
            <Input
              id="name"
              name="name"
              required
              maxlength={100}
              placeholder={m.api_token_name_placeholder()}
              aria-invalid={badIssue('name')}
            />
          </div>
          <div class="grid gap-2">
            <Label for="expiresInDays">{m.api_token_expiry()}</Label>
            <select id="expiresInDays" name="expiresInDays" class={selectClass}>
              <option value="">{m.api_token_no_expiry()}</option>
              {#each data.expiryDays as days (days)}
                <option value={String(days)}>{m.api_token_days({ days })}</option>
              {/each}
            </select>
          </div>
        </div>
        <fieldset class="grid gap-2">
          <legend class="mb-1 text-sm font-medium">{m.api_token_scopes()}</legend>
          {#each data.scopes as scope (scope)}
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="scopes" value={scope} defaultChecked={true} />
              {scopeLabel(scope)} <code class="text-muted-foreground text-xs">{scope}</code>
            </label>
          {/each}
          {#if badIssue('scopes')}
            <p class="text-destructive text-xs">{m.api_token_scopes_required()}</p>
          {/if}
        </fieldset>
        <Button type="submit" class="w-fit">{m.api_token_issue()}</Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {m.api_preview()}
        {#if data.frontend.previewSecretSet}
          <Badge variant="secondary">{m.api_preview_set()}</Badge>
        {:else}
          <Badge variant="outline">{m.api_preview_unset()}</Badge>
        {/if}
      </Card.Title>
      <Card.Description>{m.api_preview_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      {#if data.frontend.previewSecretChangedAt}
        <p class="text-muted-foreground text-sm">
          {m.api_preview_changed({ date: formatDate(data.frontend.previewSecretChangedAt) })}
        </p>
      {/if}
      {#if secret}
        <Alert.Root role="status">
          <Alert.Title>{m.api_preview_created()}</Alert.Title>
          <Alert.Description class="grid gap-2">
            <code class="bg-muted rounded px-2 py-1 font-mono text-xs break-all">{secret}</code>
            <span>{m.api_shown_once()}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="w-fit"
              onclick={() => copy(secret)}
            >
              {copied === secret ? m.api_copied() : m.api_copy()}
            </Button>
          </Alert.Description>
        </Alert.Root>
      {/if}
      <form method="POST" action="?/preview" use:enhance onsubmit={confirmRotate}>
        <Button type="submit" variant={data.frontend.previewSecretSet ? 'outline' : 'default'}>
          {data.frontend.previewSecretSet ? m.api_preview_rotate() : m.api_preview_create()}
        </Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.api_later()}</Card.Title>
      <Card.Description>{m.api_later_hint()}</Card.Description>
    </Card.Header>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.api_docs()}</Card.Title>
      <Card.Description>{m.api_docs_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <a
        class="text-primary w-fit text-sm underline underline-offset-4"
        href="/api/delivery/v1/openapi.json"
        target="_blank"
        rel="noopener"
      >
        {m.api_docs_openapi()}
      </a>
      <ApiConsole operations={data.operations} />
    </Card.Content>
  </Card.Root>
</div>
