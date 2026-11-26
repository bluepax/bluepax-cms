<script lang="ts">
  import type { Media } from '@bluepax/cms-client';
  import { altOf, srcsetOf } from '#lib/media.ts';

  let {
    media,
    locale,
    sizes = '100vw',
    eager = false,
    class: className = '',
  }: {
    media: Media | null;
    locale: string;
    sizes?: string;
    eager?: boolean;
    class?: string;
  } = $props();

  const srcset = $derived(media ? srcsetOf(media) : '');
</script>

<!-- Media URLs are absolute, at the CMS's current distribution origin. -->
{#if media?.kind === 'image'}
  <img
    class={className}
    src={media.url}
    srcset={srcset || undefined}
    sizes={srcset ? sizes : undefined}
    width={media.width ?? undefined}
    height={media.height ?? undefined}
    alt={altOf(media, locale)}
    loading={eager ? 'eager' : 'lazy'}
    decoding="async"
  />
{:else if media?.kind === 'video'}
  <video
    class={className}
    src={media.url}
    autoplay
    muted
    loop
    playsinline
    aria-label={altOf(media, locale) || undefined}
  ></video>
{/if}
