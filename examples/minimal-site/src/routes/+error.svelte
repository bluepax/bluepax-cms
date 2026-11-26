<script lang="ts">
  import { routePath } from '@bluepax/cms-client';
  import { page } from '$app/state';
  import { messages } from '#lib/i18n.ts';

  const site = $derived(page.data.site);
  const t = $derived(messages(site?.locale));
  const text = $derived.by(() => {
    switch (page.error?.code) {
      case 'preview_expired':
        return { title: t.preview, body: t.previewExpired };
      case 'preview_invalid':
        return { title: t.preview, body: t.previewInvalid };
      case 'preview_missing':
        return { title: t.preview, body: t.previewMissing };
      default:
        break;
    }
    if (page.status === 404 || page.status === 410)
      return { title: t.notFound, body: t.notFoundText };
    if (page.status === 503) return { title: t.unavailable, body: t.unavailableText };
    return { title: t.error, body: page.error?.message ?? '' };
  });
  const home = $derived(site ? routePath(site.frontend.routes.home, { locale: site.locale }) : '/');
</script>

<svelte:head>
  <title>{text.title}{site ? ` · ${site.name}` : ''}</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<article class="container error">
  <p class="status">{page.status}</p>
  <h1>{text.title}</h1>
  <p>{text.body}</p>
  <p><a href={home}>{t.backHome}</a></p>
</article>
