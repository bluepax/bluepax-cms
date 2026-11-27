<script lang="ts">
  import {
    ROUTE_KINDS,
    routePath,
    routeTemplateIssues,
    type RouteKind,
    type RouteTemplateIssue,
    type RouteTemplates,
  } from '@bluepax/presets/routes';
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, keepValues, textareaClass } from '#lib/ui.ts';
  import Notice from '../notice.svelte';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  interface InUse {
    locale: string;
    slug: string;
    title: string;
  }
  interface Result {
    failed?: string;
    reason?: string;
    details?: {
      pages?: (InUse & { pageId: string })[];
      posts?: (InUse & { postId: string })[];
      count?: number;
      changes?: { from: string; to: string }[];
    };
  }
  const result = $derived(form as Result | null);

  const invalid = $derived(failedFields(form, 'frontend'));
  const invalidRoute = $derived(failedFields(form, 'routes'));

  /** Pages and posts whose slug was to become reserved (a reserved slug or a fixed segment). */
  const inUse = $derived.by(() => {
    if (result?.reason !== 'slug_in_use') return [];
    return [
      ...(result.details?.pages ?? []).map((p) => ({
        ...p,
        href: `/pages/${p.pageId}`,
        key: `page:${p.pageId}:${p.locale}`,
      })),
      ...(result.details?.posts ?? []).map((p) => ({
        ...p,
        href: `/posts/${p.postId}`,
        key: `post:${p.postId}:${p.locale}`,
      })),
    ];
  });

  // Route templates as typed, checked while typing with the same rules as the server. Saved
  // values come back with the reloaded data.
  let routes: Record<RouteKind, string> = $derived({ ...data.frontend.routes });
  const issues = $derived(routeTemplateIssues(routes as RouteTemplates));
  const issueOf = (kind: RouteKind) => issues.find((i) => i.kind === kind);

  const LABELS: Record<RouteKind, () => string> = {
    home: m.settings_routes_home,
    page: m.settings_routes_page,
    post: m.settings_routes_post,
    postCategory: m.settings_routes_postCategory,
    tag: m.settings_routes_tag,
    author: m.settings_routes_author,
  };
  const SAMPLE_SLUGS: Record<RouteKind, string> = {
    home: '',
    page: 'about',
    post: 'hello-world',
    postCategory: 'news',
    tag: 'tips',
    author: 'alex',
  };
  const placeholders = { locale: '{locale}', slug: '{slug}' };

  function note(kind: RouteKind): string {
    if (kind === 'home') return m.settings_routes_home_note(placeholders);
    if (kind === 'author') return m.settings_routes_author_note(placeholders);
    return m.settings_routes_slug_note(placeholders);
  }

  function issueText(issue: RouteTemplateIssue): string {
    switch (issue.code) {
      case 'format':
        return m.settings_routes_issue_format({ example: '/{locale}/blog/{slug}' });
      case 'segment':
        return m.settings_routes_issue_segment({ placeholders: '{locale}, {slug}' });
      case 'locale_first':
        return m.settings_routes_issue_locale_first({ prefix: '/{locale}' });
      case 'placeholders':
        return m.settings_routes_issue_placeholders({
          placeholders: issue.kind === 'home' ? '{locale}' : '{locale}, {slug}',
        });
      case 'overlap':
        return m.settings_routes_issue_overlap({
          other: issue.other ? LABELS[issue.other]() : '',
          example: issue.example ?? '',
        });
    }
  }

  const example = (kind: RouteKind) =>
    data.frontend.baseUrl +
    routePath(routes[kind], { locale: data.primary, slug: SAMPLE_SLUGS[kind] });

  /** Published addresses the change moves; the admin confirms their number. */
  // Raw: compared by identity with `form`, which a deep $state proxy would never equal.
  let dismissed = $state.raw<unknown>(null);
  const confirmation = $derived(
    result?.failed === 'routes' && result.reason === 'confirm_required' && dismissed !== form
      ? { count: result.details?.count ?? 0, changes: result.details?.changes ?? [] }
      : null,
  );
  function discard() {
    routes = { ...data.frontend.routes };
    dismissed = form;
  }
</script>

<svelte:head>
  <title>{m.settings_frontend()} · {m.app_name()}</title>
</svelte:head>

{#if result?.reason !== 'confirm_required'}
  <Notice {form} texts={{ routes: m.settings_routes_saved() }} />
{/if}

{#if inUse.length > 0}
  <Alert.Root variant="destructive" class="mb-6 max-w-3xl" role="alert">
    <Alert.Title>
      {result?.failed === 'routes'
        ? m.settings_routes_slug_in_use()
        : m.settings_frontend_slug_in_use()}
    </Alert.Title>
    <Alert.Description>
      <ul class="list-disc ps-5">
        {#each inUse as item (item.key)}
          <li>
            <a href="{item.href}?locale={encodeURIComponent(item.locale)}" class="underline">
              {item.title}
            </a>
            <span class="font-mono text-xs">· {item.locale} · {item.slug}</span>
          </li>
        {/each}
      </ul>
    </Alert.Description>
  </Alert.Root>
{/if}

<div class="grid max-w-3xl gap-6">
  <form method="POST" action="?/routes" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_routes()}</Card.Title>
        <Card.Description>{m.settings_routes_hint(placeholders)}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-5">
        <div class="grid gap-1">
          <span class="text-sm font-medium">{m.settings_frontend_base_url()}</span>
          <p class="font-mono text-sm" dir="ltr">{data.frontend.baseUrl}</p>
        </div>
        {#each ROUTE_KINDS as kind (kind)}
          {@const issue = issueOf(kind)}
          <div class="grid gap-1.5">
            <Label for="route-{kind}">{LABELS[kind]()}</Label>
            <Input
              id="route-{kind}"
              name={kind}
              class="font-mono"
              dir="ltr"
              autocomplete="off"
              spellcheck={false}
              placeholder={data.defaults[kind]}
              aria-invalid={Boolean(issue) || invalidRoute(`routes.${kind}`)}
              aria-describedby="route-{kind}-note"
              value={routes[kind]}
              oninput={(event) => (routes = { ...routes, [kind]: event.currentTarget.value })}
            />
            <p id="route-{kind}-note" class="text-muted-foreground text-xs">
              {note(kind)}
              {#if routes[kind].trim() !== data.defaults[kind]}
                {m.settings_routes_default({ template: data.defaults[kind] })}
              {/if}
            </p>
            {#if issue}
              <p class="text-destructive text-xs" role="alert">{issueText(issue)}</p>
            {:else if invalidRoute(`routes.${kind}`) && result?.reason === 'slug_in_use'}
              <p class="text-destructive text-xs" role="alert">
                {m.settings_routes_issue_in_use()}
              </p>
            {:else}
              <p class="text-muted-foreground font-mono text-xs break-all" dir="ltr">
                {m.settings_routes_example({ url: example(kind) })}
              </p>
            {/if}
          </div>
        {/each}

        {#if confirmation}
          <Alert.Root role="alert">
            <Alert.Title>
              {m.settings_routes_confirm_title({ count: confirmation.count })}
            </Alert.Title>
            <Alert.Description class="grid gap-2">
              <p>{m.settings_routes_confirm_text()}</p>
              <ul class="grid gap-0.5 font-mono text-xs" dir="ltr">
                {#each confirmation.changes as change (change.from)}
                  <li class="break-all">{change.from} → {change.to}</li>
                {/each}
              </ul>
              {#if confirmation.count > confirmation.changes.length}
                <p>
                  {m.settings_routes_confirm_more({
                    count: confirmation.count - confirmation.changes.length,
                  })}
                </p>
              {/if}
            </Alert.Description>
          </Alert.Root>
          <div class="flex flex-wrap gap-2">
            <Button type="submit" name="confirm" value={String(confirmation.count)}>
              {m.settings_routes_confirm()}
            </Button>
            <Button type="button" variant="outline" onclick={discard}>
              {m.settings_routes_cancel()}
            </Button>
          </div>
        {:else}
          <div><Button type="submit" disabled={issues.length > 0}>{m.save()}</Button></div>
        {/if}
      </Card.Content>
    </Card.Root>
  </form>

  <form method="POST" action="?/reserved" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.settings_frontend_reserved()}</Card.Title>
        <Card.Description>{m.settings_frontend_reserved_hint()}</Card.Description>
      </Card.Header>
      <Card.Content class="grid gap-4">
        <div class="grid gap-2">
          <Label for="reservedSlugs" class="sr-only">{m.settings_frontend_reserved()}</Label>
          <textarea
            id="reservedSlugs"
            name="reservedSlugs"
            class="{textareaClass} min-h-32 font-mono"
            dir="ltr"
            aria-invalid={invalid('reservedSlugs')}
            value={data.frontend.reservedSlugs.join('\n')}></textarea>
        </div>
        <div class="grid gap-2">
          <span class="text-sm font-medium">{m.settings_frontend_route_segments()}</span>
          <p class="font-mono text-sm" dir="ltr">{data.routeSegments.join(', ')}</p>
          <p class="text-muted-foreground text-xs">{m.settings_frontend_route_segments_hint()}</p>
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </Card.Content>
    </Card.Root>
  </form>
</div>
