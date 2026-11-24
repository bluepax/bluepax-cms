<script lang="ts">
  import { Input } from '#lib/components/ui/input/index.js';
  import { textareaClass } from '#lib/ui.ts';

  // One input per content language, named `<name>.<language>`; RTL languages get dir="rtl".
  let {
    id,
    name,
    label,
    hint,
    languages,
    values = {},
    primary,
    multiline = false,
    maxlength,
    invalid = () => false,
  }: {
    id: string;
    name: string;
    label: string;
    hint?: string;
    languages: { code: string; dir: 'ltr' | 'rtl' }[];
    values?: Record<string, string | undefined>;
    /** Language that must be filled in, if any. */
    primary?: string;
    multiline?: boolean;
    maxlength?: number;
    invalid?: (field: string) => boolean;
  } = $props();
</script>

<fieldset class="grid gap-2">
  <legend class="mb-2 text-sm font-medium">{label}</legend>
  {#each languages as language (language.code)}
    {@const fieldName = `${name}.${language.code}`}
    <div class="flex items-start gap-2">
      <label
        for="{id}-{language.code}"
        class="text-muted-foreground w-16 shrink-0 pt-2 font-mono text-xs"
      >
        {language.code}{language.code === primary ? ' *' : ''}
      </label>
      {#if multiline}
        <textarea
          id="{id}-{language.code}"
          name={fieldName}
          class={textareaClass}
          dir={language.dir}
          lang={language.code}
          {maxlength}
          required={language.code === primary}
          aria-invalid={invalid(fieldName)}
          value={values[language.code] ?? ''}></textarea>
      {:else}
        <Input
          id="{id}-{language.code}"
          name={fieldName}
          dir={language.dir}
          lang={language.code}
          {maxlength}
          required={language.code === primary}
          aria-invalid={invalid(fieldName)}
          value={values[language.code] ?? ''}
        />
      {/if}
    </div>
  {/each}
  {#if hint}<p class="text-muted-foreground text-xs">{hint}</p>{/if}
</fieldset>
