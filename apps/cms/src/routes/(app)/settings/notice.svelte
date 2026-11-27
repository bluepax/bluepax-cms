<script lang="ts">
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { m } from '#lib/paraglide/messages.js';

  // Result of a settings form action: `{ saved }` or `{ failed, invalid }`.
  let { form, texts = {} }: { form: unknown; texts?: Record<string, string> } = $props();

  const notice = $derived.by(() => {
    const result = form as { saved?: string; failed?: string } | null | undefined;
    if (result?.failed) return { error: true, text: m.settings_invalid() };
    if (result?.saved) return { error: false, text: texts[result.saved] ?? m.saved() };
    return null;
  });
</script>

{#if notice}
  <Alert.Root
    variant={notice.error ? 'destructive' : 'default'}
    class="mb-6 max-w-3xl"
    role="status"
  >
    <Alert.Description>{notice.text}</Alert.Description>
  </Alert.Root>
{/if}
