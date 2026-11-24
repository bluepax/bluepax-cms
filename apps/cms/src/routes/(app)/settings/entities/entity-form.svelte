<script lang="ts">
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import LocalizedField from '../localized-field.svelte';

  // Fields of a legal entity, shared by the new and edit pages.
  type Values = {
    legalName: Record<string, string>;
    role: Record<string, string>;
    registrationNumber: string;
    registrationNumberPublic: boolean;
    taxId: string;
    taxIdPublic: boolean;
    email: string;
    phone: string;
    sortOrder: number;
  };
  let {
    languages,
    primary,
    values,
    invalid,
  }: {
    languages: { code: string; dir: 'ltr' | 'rtl' }[];
    primary: string;
    values?: Values;
    invalid: (field: string) => boolean;
  } = $props();
</script>

<LocalizedField
  id="legalName"
  name="legalName"
  label={m.settings_entity_legal_name()}
  {languages}
  {primary}
  values={values?.legalName}
  maxlength={300}
  {invalid}
/>
<LocalizedField
  id="role"
  name="role"
  label={m.settings_entity_role()}
  hint={m.settings_entity_role_hint()}
  {languages}
  values={values?.role}
  maxlength={100}
  {invalid}
/>
<div class="grid items-start gap-4 sm:grid-cols-2">
  <div class="grid gap-2">
    <Label for="registrationNumber">{m.settings_entity_registration()}</Label>
    <Input
      id="registrationNumber"
      name="registrationNumber"
      value={values?.registrationNumber ?? ''}
      aria-invalid={invalid('registrationNumber')}
    />
    <label class="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        name="registrationNumberPublic"
        checked={values?.registrationNumberPublic ?? false}
      />
      {m.settings_entity_public()}
    </label>
  </div>
  <div class="grid gap-2">
    <Label for="taxId">{m.settings_entity_tax_id()}</Label>
    <Input id="taxId" name="taxId" value={values?.taxId ?? ''} aria-invalid={invalid('taxId')} />
    <label class="flex items-center gap-2 text-sm">
      <input type="checkbox" name="taxIdPublic" checked={values?.taxIdPublic ?? false} />
      {m.settings_entity_public()}
    </label>
  </div>
</div>
<p class="text-muted-foreground -mt-2 text-xs">{m.settings_entity_public_hint()}</p>
<div class="grid items-start gap-4 sm:grid-cols-3">
  <div class="grid gap-2">
    <Label for="entity-email">{m.users_email()}</Label>
    <Input
      id="entity-email"
      name="email"
      type="email"
      value={values?.email ?? ''}
      aria-invalid={invalid('email')}
    />
  </div>
  <div class="grid gap-2">
    <Label for="entity-phone">{m.settings_phone()}</Label>
    <Input
      id="entity-phone"
      name="phone"
      type="tel"
      value={values?.phone ?? ''}
      aria-invalid={invalid('phone')}
    />
  </div>
  <div class="grid gap-2">
    <Label for="entity-sortOrder">{m.settings_sort_order()}</Label>
    <Input
      id="entity-sortOrder"
      name="sortOrder"
      type="number"
      step="1"
      value={String(values?.sortOrder ?? 0)}
      aria-invalid={invalid('sortOrder')}
    />
  </div>
</div>
