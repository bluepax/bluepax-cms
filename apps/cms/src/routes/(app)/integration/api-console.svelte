<script lang="ts">
  // The online console of the OpenAPI document (chapter 6, docs/adr/0012): calls the real
  // Delivery API from this page with a token the admin pastes in. The token stays in this page's
  // memory only; it is never stored or sent anywhere but to this CMS.
  import { Button } from '#lib/components/ui/button/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { selectClass } from '#lib/ui.ts';

  interface Operation {
    operationId: string;
    path: string;
    summary: string;
    params: { name: string; in: 'query' | 'path'; required: boolean }[];
  }

  let { operations }: { operations: Operation[] } = $props();

  let token = $state('');
  let operationId = $state('getSite');
  let values = $state<Record<string, string>>({});
  let response = $state<{ status: number; headers: string; body: string } | null>(null);
  let busy = $state(false);

  const operation = $derived(operations.find((o) => o.operationId === operationId)!);

  const url = $derived.by(() => {
    let path = operation.path;
    const query: string[] = [];
    for (const param of operation.params) {
      const value = values[`${operationId}.${param.name}`]?.trim() ?? '';
      if (param.in === 'path') path = path.replace(`{${param.name}}`, encodeURIComponent(value));
      else if (value) query.push(`${param.name}=${encodeURIComponent(value)}`);
    }
    return `/api/delivery/v1${path}${query.length > 0 ? `?${query.join('&')}` : ''}`;
  });

  async function send() {
    busy = true;
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token.trim()}` } });
      const text = await res.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON (e.g. 304): shown as it is.
      }
      const shown = [
        'content-type',
        'etag',
        'last-modified',
        'cache-control',
        'x-ratelimit-remaining',
        'retry-after',
      ];
      response = {
        status: res.status,
        headers: shown
          .flatMap((name) => (res.headers.get(name) ? [`${name}: ${res.headers.get(name)}`] : []))
          .join('\n'),
        body,
      };
    } finally {
      busy = false;
    }
  }
</script>

<form
  class="grid gap-4 border-t pt-4"
  onsubmit={(event) => {
    event.preventDefault();
    void send();
  }}
>
  <h3 class="text-sm font-medium">{m.api_console()}</h3>
  <div class="grid gap-2">
    <Label for="console-token">{m.api_console_token()}</Label>
    <Input
      id="console-token"
      type="password"
      autocomplete="off"
      placeholder="bpxd_…"
      bind:value={token}
      required
    />
    <p class="text-muted-foreground text-xs">{m.api_console_token_hint()}</p>
  </div>
  <div class="grid gap-2">
    <Label for="console-operation">{m.api_console_endpoint()}</Label>
    <select id="console-operation" class={selectClass} bind:value={operationId}>
      {#each operations as op (op.operationId)}
        <option value={op.operationId}>GET {op.path} — {op.summary}</option>
      {/each}
    </select>
  </div>
  {#if operation.params.length > 0}
    <div class="grid gap-3 sm:grid-cols-2">
      {#each operation.params as param (`${operationId}.${param.name}`)}
        <div class="grid gap-1">
          <Label for={`console-${param.name}`}>
            {param.name}{param.required ? ' *' : ''}
            <span class="text-muted-foreground text-xs">({param.in})</span>
          </Label>
          <Input
            id={`console-${param.name}`}
            required={param.required}
            bind:value={values[`${operationId}.${param.name}`]}
          />
        </div>
      {/each}
    </div>
  {/if}
  <code class="bg-muted rounded px-2 py-1 font-mono text-xs break-all">GET {url}</code>
  <Button type="submit" class="w-fit" disabled={busy}>{m.api_console_send()}</Button>
  {#if response}
    <div class="grid gap-2" data-testid="console-response">
      <p class="text-sm font-medium">HTTP {response.status}</p>
      <pre class="bg-muted overflow-x-auto rounded p-2 text-xs">{response.headers}</pre>
      <pre class="bg-muted max-h-96 overflow-auto rounded p-2 text-xs">{response.body}</pre>
    </div>
  {/if}
</form>
