<script lang="ts">
  import './layout.css';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <title>BluePax CMS</title>
</svelte:head>

{@render children()}
