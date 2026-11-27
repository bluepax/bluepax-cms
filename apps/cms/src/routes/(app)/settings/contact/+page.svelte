<script lang="ts">
  import { enhance } from '$app/forms';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import TrashIcon from '@lucide/svelte/icons/trash-2';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues } from '#lib/ui.ts';
  import LocalizedField from '../localized-field.svelte';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const badContact = $derived(failedFields(form, 'contact'));
  const badIm = $derived(failedFields(form, 'im'));
  const badSocial = $derived(failedFields(form, 'social'));

  // Suggestions only: any lowercase key works, the frontend maps it to a link and an icon.
  const channels = ['whatsapp', 'telegram', 'line', 'viber', 'wechat', 'messenger', 'signal'];
  const networks = [
    'linkedin',
    'x',
    'facebook',
    'instagram',
    'youtube',
    'tiktok',
    'github',
    'weibo',
    'bilibili',
    'xiaohongshu',
  ];

  // Rows are uncontrolled inputs keyed by row; a successful save reloads the stored links.
  let nextKey = 0;
  let links = $derived(data.social.links.map((l) => ({ key: nextKey++, ...l })));
</script>

<svelte:head>
  <title>{m.settings_contact()} · {m.app_name()}</title>
</svelte:head>

<Notice {form} texts={{ removeIm: m.settings_im_removed() }} />

<datalist id="im-channels">
  {#each channels as channel (channel)}<option value={channel}></option>{/each}
</datalist>
<datalist id="social-networks">
  {#each networks as network (network)}<option value={network}></option>{/each}
</datalist>

<div class="grid max-w-3xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_contact()}</Card.Title>
      <Card.Description>{m.settings_contact_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/contact" use:enhance={keepValues} class="grid gap-4">
        <div class="grid items-start gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="email">{m.users_email()}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              value={data.contact.email}
              aria-invalid={badContact('email')}
            />
          </div>
          <div class="grid gap-2">
            <Label for="phone">{m.settings_phone()}</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              value={data.contact.phone}
              aria-invalid={badContact('phone')}
            />
          </div>
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_im()}</Card.Title>
      <Card.Description>{m.settings_im_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/im" use:enhance={keepValues} class="grid gap-4">
        <div class="grid items-start gap-4 sm:grid-cols-2">
          <div class="grid gap-2">
            <Label for="channel">{m.settings_im_channel()}</Label>
            <Input
              id="channel"
              name="channel"
              list="im-channels"
              placeholder="whatsapp"
              value={data.im?.channel ?? ''}
              required
              aria-invalid={badIm('im.channel')}
            />
            <p class="text-muted-foreground text-xs">{m.settings_key_hint()}</p>
          </div>
          <div class="grid gap-2">
            <Label for="number">{m.settings_im_number()}</Label>
            <Input
              id="number"
              name="number"
              value={data.im?.number ?? ''}
              required
              aria-invalid={badIm('im.number')}
            />
          </div>
        </div>
        <LocalizedField
          id="im-text"
          name="text"
          label={m.settings_im_text()}
          hint={m.settings_im_text_hint()}
          languages={data.languages}
          values={data.im?.text}
          multiline
          maxlength={500}
          invalid={(f) => badIm(`im.${f}`)}
        />
        <div class="flex gap-2">
          <Button type="submit">{m.save()}</Button>
          {#if data.im}
            <Button type="submit" variant="outline" formaction="?/removeIm" formnovalidate>
              {m.settings_im_remove()}
            </Button>
          {/if}
        </div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_social()}</Card.Title>
      <Card.Description>{m.settings_social_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/social" use:enhance={keepValues} class="grid gap-4">
        {#if links.length === 0}
          <p class="text-muted-foreground text-sm">{m.settings_social_none()}</p>
        {/if}
        {#each links as link, i (link.key)}
          <div class="flex items-center gap-2">
            <Input
              name="network"
              class="max-w-40"
              list="social-networks"
              placeholder="linkedin"
              aria-label={m.settings_social_network()}
              value={link.network}
              required
              aria-invalid={badSocial(`links.${i}.network`)}
            />
            <Input
              name="url"
              type="url"
              placeholder="https://"
              aria-label={m.settings_social_url()}
              value={link.url}
              required
              aria-invalid={badSocial(`links.${i}.url`)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={m.settings_remove()}
              onclick={() => (links = links.filter((l) => l.key !== link.key))}
            >
              <TrashIcon class="size-4" />
            </Button>
          </div>
        {/each}
        <div class="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onclick={() => (links = [...links, { key: nextKey++, network: '', url: '' }])}
          >
            <PlusIcon class="size-4" />
            {m.settings_social_add()}
          </Button>
          <Button type="submit">{m.save()}</Button>
        </div>
      </form>
    </Card.Content>
  </Card.Root>
</div>
