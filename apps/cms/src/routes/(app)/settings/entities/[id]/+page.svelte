<script lang="ts">
  import { enhance } from '$app/forms';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues } from '#lib/ui.ts';
  import LocalizedField from '../../localized-field.svelte';
  import Notice from '../../notice.svelte';
  import EntityForm from '../entity-form.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const entity = $derived(data.entity);
  const bad = $derived(failedFields(form, 'update'));
  const title = $derived(
    entity.legalName[data.primaryLanguage] ?? Object.values(entity.legalName)[0] ?? '—',
  );
  type Location = (typeof data.entity.locations)[number];
  const addressParts = [
    { part: 'street', text: m.settings_location_street() },
    { part: 'locality', text: m.settings_location_locality() },
    { part: 'region', text: m.settings_location_region() },
  ] as const;

  const confirmDelete = (message: string) => (event: Event) => {
    if (!confirm(message)) event.preventDefault();
  };
  const label = (location: Location) =>
    location.name[data.primaryLanguage] ??
    Object.values(location.name)[0] ??
    location.address[data.primaryLanguage]?.locality ??
    m.settings_location_unnamed();
</script>

<svelte:head>
  <title>{title} · {m.app_name()}</title>
</svelte:head>

{#snippet locationFields(location: Location | undefined, invalid: (field: string) => boolean)}
  {@const key = location?.id ?? 'new'}
  <LocalizedField
    id="name-{key}"
    name="name"
    label={m.settings_location_name()}
    languages={data.languages}
    values={location?.name}
    maxlength={200}
    {invalid}
  />
  <fieldset class="grid gap-2">
    <legend class="mb-2 text-sm font-medium">{m.settings_location_address()}</legend>
    {#each data.languages as language (language.code)}
      <div class="flex items-start gap-2">
        <span class="text-muted-foreground w-16 shrink-0 pt-2 font-mono text-xs">
          {language.code}
        </span>
        <div class="grid flex-1 gap-2 sm:grid-cols-[2fr_1fr_1fr]">
          {#each addressParts as field (field.part)}
            <Input
              name="{field.part}.{language.code}"
              placeholder={field.text}
              aria-label="{field.text} ({language.code})"
              dir={language.dir}
              lang={language.code}
              value={location?.address[language.code]?.[field.part] ?? ''}
              aria-invalid={invalid(`address.${language.code}.${field.part}`)}
            />
          {/each}
        </div>
      </div>
    {/each}
  </fieldset>
  <div class="grid items-start gap-4 sm:grid-cols-3">
    <div class="grid gap-2">
      <Label for="postalCode-{key}">{m.settings_location_postal_code()}</Label>
      <Input
        id="postalCode-{key}"
        name="postalCode"
        value={location?.postalCode ?? ''}
        aria-invalid={invalid('postalCode')}
      />
    </div>
    <div class="grid gap-2">
      <Label for="country-{key}">{m.settings_location_country()}</Label>
      <Input
        id="country-{key}"
        name="country"
        class="uppercase"
        maxlength={2}
        placeholder="CN"
        value={location?.country ?? ''}
        aria-invalid={invalid('country')}
      />
      <p class="text-muted-foreground text-xs">{m.settings_location_country_hint()}</p>
    </div>
    <div class="grid gap-2">
      <Label for="sortOrder-{key}">{m.settings_sort_order()}</Label>
      <Input
        id="sortOrder-{key}"
        name="sortOrder"
        type="number"
        step="1"
        placeholder="0"
        value={location ? String(location.sortOrder) : ''}
      />
    </div>
    <div class="grid gap-2">
      <Label for="phone-{key}">{m.settings_phone()}</Label>
      <Input
        id="phone-{key}"
        name="phone"
        type="tel"
        value={location?.phone ?? ''}
        aria-invalid={invalid('phone')}
      />
    </div>
    <div class="grid gap-2">
      <Label for="email-{key}">{m.users_email()}</Label>
      <Input
        id="email-{key}"
        name="email"
        type="email"
        value={location?.email ?? ''}
        aria-invalid={invalid('email')}
      />
    </div>
    <div class="grid gap-2">
      <Label for="openingHours-{key}">{m.settings_location_hours()}</Label>
      <Input
        id="openingHours-{key}"
        name="openingHours"
        placeholder="Mo-Fr 09:00-18:00"
        value={location?.openingHours ?? ''}
        aria-invalid={invalid('openingHours')}
      />
    </div>
    <div class="grid gap-2">
      <Label for="latitude-{key}">{m.settings_location_latitude()}</Label>
      <Input
        id="latitude-{key}"
        name="latitude"
        type="number"
        step="any"
        min="-90"
        max="90"
        value={location?.latitude ?? ''}
        aria-invalid={invalid('latitude')}
      />
    </div>
    <div class="grid gap-2">
      <Label for="longitude-{key}">{m.settings_location_longitude()}</Label>
      <Input
        id="longitude-{key}"
        name="longitude"
        type="number"
        step="any"
        min="-180"
        max="180"
        value={location?.longitude ?? ''}
        aria-invalid={invalid('longitude')}
      />
    </div>
  </div>
  {#if invalid('latitude')}
    <p class="text-destructive text-sm">{m.settings_location_coordinates()}</p>
  {/if}
{/snippet}

<a href="/settings/entities" class="text-muted-foreground mb-4 inline-block text-sm">
  ← {m.settings_entities()}
</a>
<Notice
  form={form ?? (data.created ? { saved: 'create' } : null)}
  texts={{ create: m.settings_entity_created(), 'location:new': m.settings_location_added() }}
/>

<div class="grid max-w-3xl gap-6">
  <form method="POST" action="?/update" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header><Card.Title>{title}</Card.Title></Card.Header>
      <Card.Content class="grid gap-4">
        <EntityForm
          languages={data.languages}
          primary={data.primaryLanguage}
          values={entity}
          invalid={bad}
        />
        <div class="flex gap-2">
          <Button type="submit">{m.save()}</Button>
          <Button
            type="submit"
            variant="destructive"
            formaction="?/delete"
            formnovalidate
            onclick={confirmDelete(m.settings_entity_delete_confirm())}
          >
            {m.settings_entity_delete()}
          </Button>
        </div>
      </Card.Content>
    </Card.Root>
  </form>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.settings_locations()}</Card.Title>
      <Card.Description>{m.settings_locations_hint()}</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-3">
      {#each entity.locations as location (location.id)}
        <details class="rounded-md border">
          <summary class="cursor-pointer px-4 py-3 text-sm font-medium">
            {label(location)}
            {#if location.country}
              <span class="text-muted-foreground font-normal">· {location.country}</span>
            {/if}
          </summary>
          <form
            method="POST"
            action="?/updateLocation"
            use:enhance={keepValues}
            class="grid gap-4 border-t p-4"
          >
            <input type="hidden" name="location" value={location.id} />
            {@render locationFields(location, failedFields(form, `location:${location.id}`))}
            <div class="flex gap-2">
              <Button type="submit" size="sm">{m.save()}</Button>
              <Button
                type="submit"
                size="sm"
                variant="outline"
                formaction="?/deleteLocation"
                formnovalidate
                onclick={confirmDelete(m.settings_location_delete_confirm())}
              >
                {m.settings_location_delete()}
              </Button>
            </div>
          </form>
        </details>
      {:else}
        <p class="text-muted-foreground text-sm">{m.settings_locations_none()}</p>
      {/each}

      <details class="rounded-md border border-dashed" open={form?.failed === 'location:new'}>
        <summary class="cursor-pointer px-4 py-3 text-sm font-medium">
          {m.settings_location_add()}
        </summary>
        <form method="POST" action="?/addLocation" use:enhance class="grid gap-4 border-t p-4">
          {@render locationFields(undefined, failedFields(form, 'location:new'))}
          <div><Button type="submit" size="sm">{m.settings_location_add()}</Button></div>
        </form>
      </details>
    </Card.Content>
  </Card.Root>
</div>
