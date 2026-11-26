<script lang="ts">
  // "预览" in the page and post editors: asks for a signed link to the frontend's preview route
  // (valid for one hour) and offers to open it. It shows the saved version.
  import { Button } from '#lib/components/ui/button/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { formatDate } from '#lib/ui.ts';

  let { type, id, locale }: { type: 'page' | 'post'; id: string; locale: string } = $props();

  let link = $state<{ url: string; expiresAt: string } | null>(null);
  let problem = $state<string | null>(null);
  let busy = $state(false);

  async function create() {
    busy = true;
    problem = null;
    try {
      const response = await fetch('/preview-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, locale }),
      });
      if (response.status === 409) problem = m.preview_unavailable();
      else if (!response.ok) problem = m.error_not_found();
      else link = await response.json();
    } finally {
      busy = false;
    }
  }
</script>

<Button type="button" size="sm" variant="outline" onclick={create} disabled={busy}>
  {m.preview_open()}
</Button>
{#if problem}
  <p class="text-destructive basis-full text-xs" role="status">{problem}</p>
{:else if link}
  <p class="text-muted-foreground basis-full text-xs break-all" role="status">
    {m.preview_link_ready({ date: formatDate(link.expiresAt) })}
    <a
      class="text-primary underline underline-offset-4"
      href={link.url}
      target="_blank"
      rel="noopener"
    >
      {m.preview_open_link()}
    </a>
  </p>
{/if}
