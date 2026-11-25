<script lang="ts">
  import TermEditor from '../../term-editor.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<TermEditor {data} {form} />
