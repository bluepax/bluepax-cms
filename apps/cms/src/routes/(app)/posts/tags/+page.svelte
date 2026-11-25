<script lang="ts">
  import TermList from '../term-list.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
</script>

<TermList {data} {form} />
