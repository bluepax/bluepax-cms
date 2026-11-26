<script lang="ts">
  import PageView from '#lib/components/PageView.svelte';
  import PostView from '#lib/components/PostView.svelte';
  import Seo from '#lib/components/Seo.svelte';
  import { formatDateTime } from '#lib/format.ts';
  import { messages } from '#lib/i18n.ts';

  let { data } = $props();
  const preview = $derived(data.preview);
  const site = $derived(data.site);
  const t = $derived(messages(site.locale));
  const content = $derived(preview.type === 'page' ? preview.page : preview.post);
</script>

<!-- seo.robots is always `noindex, nofollow` in a preview. -->
<Seo seo={content.seo} />

<p class="preview-banner" role="status">
  <strong>{t.preview}</strong> · {t.status[preview.status]} · {t.previewExpires}
  {formatDateTime(preview.expiresAt, site.locale, site.timezone)}
</p>

{#if preview.type === 'page'}
  <PageView page={preview.page} {site} />
{:else}
  <PostView post={preview.post} {site} />
{/if}
