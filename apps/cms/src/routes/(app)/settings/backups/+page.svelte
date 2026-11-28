<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import DatabaseBackupIcon from '@lucide/svelte/icons/database-backup';
  import DownloadIcon from '@lucide/svelte/icons/download';
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
  import Trash2Icon from '@lucide/svelte/icons/trash-2';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { formatBytes } from '#lib/media.ts';
  import { m } from '#lib/paraglide/messages.js';
  import { failedFields, formatDateIn, keepValues } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const o = $derived(data.overview);
  const bad = $derived(failedFields(form, 'settings'));
  const result = $derived(form as { saved?: string; failed?: string; reason?: string } | null);

  const notice = $derived.by(() => {
    if (result?.reason === 'backup_pending') return { error: true, text: m.backups_run_pending() };
    if (result?.reason === 'backups_off') return { error: true, text: m.backups_disabled() };
    if (result?.failed) return { error: true, text: m.settings_invalid() };
    if (result?.saved === 'run') return { error: false, text: m.backups_run_queued() };
    if (result?.saved === 'delete') return { error: false, text: m.backups_deleted() };
    if (result?.saved === 'settings') return { error: false, text: m.backups_saved() };
    return null;
  });

  // Every time on this page is in the site's time zone, the zone the schedule runs in.
  const at = (value: string | null) => formatDateIn(value, o.settings.timeZone);

  const lastDaily = $derived(o.runs.find((r) => r.kind === 'daily' && r.status !== 'running'));
  const running = $derived(o.runs.some((r) => r.status === 'running'));

  function kindLabel(kind: string): string {
    if (kind === 'daily') return m.backups_kind_daily();
    if (kind === 'manual') return m.backups_kind_manual();
    if (kind === 'pre-migrate') return m.backups_kind_pre_migrate();
    return kind;
  }

  function duration(start: string, end: string | null): string {
    if (!end) return '—';
    const seconds = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
    return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  }

  function confirmDelete(name: string) {
    return (event: SubmitEvent) => {
      if (!confirm(m.backups_delete_confirm({ name }))) event.preventDefault();
    };
  }
</script>

<svelte:head>
  <title>{m.settings_backups()} · {m.app_name()}</title>
</svelte:head>

{#if notice}
  <Alert.Root
    variant={notice.error ? 'destructive' : 'default'}
    class="mb-6 max-w-4xl"
    role="status"
  >
    <Alert.Description>{notice.text}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid max-w-4xl gap-6">
  <Card.Root>
    <Card.Header class="flex flex-row items-start justify-between gap-4">
      <div class="grid gap-1.5">
        <Card.Title class="flex items-center gap-2">
          {m.backups_status_title()}
          {#if !o.enabled}
            <Badge variant="outline">{m.backups_off()}</Badge>
          {:else if o.workers.length === 0}
            <Badge variant="destructive">{m.backups_worker_none_badge()}</Badge>
          {:else}
            <Badge variant="secondary">{m.backups_on()}</Badge>
          {/if}
        </Card.Title>
        <Card.Description>
          {m.backups_status_hint({
            time: o.settings.time,
            timeZone: o.settings.timeZone,
            keepDaily: String(o.settings.keepDaily),
            keepWeekly: String(o.settings.keepWeekly),
          })}
        </Card.Description>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button variant="outline" size="sm" onclick={() => invalidateAll()}>
          <RefreshCwIcon class="size-4" />
          {m.backups_refresh()}
        </Button>
        <form method="POST" action="?/run" use:enhance>
          <Button type="submit" size="sm" disabled={!o.enabled}>
            <DatabaseBackupIcon class="size-4" />
            {m.backups_run_now()}
          </Button>
        </form>
      </div>
    </Card.Header>
    <Card.Content class="grid gap-3 text-sm">
      {#if !o.enabled}
        <p class="text-muted-foreground">{m.backups_disabled()}</p>
      {:else if o.workers.length === 0}
        <p class="text-destructive">{m.backups_worker_none()}</p>
      {/if}
      <dl class="grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt class="text-muted-foreground">{m.backups_next()}</dt>
        <dd>
          {o.next ? at(o.next) : '—'}
          {#if !o.scheduled && o.enabled}
            <span class="text-muted-foreground"> · {m.backups_not_scheduled()}</span>
          {/if}
        </dd>
        <dt class="text-muted-foreground">{m.backups_last()}</dt>
        <dd>
          {#if lastDaily}
            {at(lastDaily.startedAt)} ·
            {#if lastDaily.status === 'succeeded'}
              <span>{m.backups_status_succeeded()}</span>
            {:else}
              <span class="text-destructive">{m.backups_status_failed()}</span>
            {/if}
          {:else}
            {m.never()}
          {/if}
        </dd>
        <dt class="text-muted-foreground">{m.backups_workers()}</dt>
        <dd>
          {#if o.workers.length === 0}
            —
          {:else}
            {#each o.workers as w (`${w.host}:${w.pid}`)}
              <div>
                {w.host} · pid {w.pid} ·
                {m.backups_heartbeat({ time: at(w.heartbeatAt) })}
              </div>
            {/each}
          {/if}
        </dd>
      </dl>
    </Card.Content>
  </Card.Root>

  <form method="POST" action="?/settings" use:enhance={keepValues}>
    <Card.Root>
      <Card.Header>
        <Card.Title>{m.backups_settings_title()}</Card.Title>
        <Card.Description>
          {m.backups_settings_hint({ timeZone: o.settings.timeZone })}
        </Card.Description>
      </Card.Header>
      <Card.Content class="grid items-start gap-4 sm:grid-cols-3">
        <div class="grid gap-2">
          <Label for="time">{m.backups_time()}</Label>
          <Input
            id="time"
            name="time"
            type="time"
            value={o.settings.time}
            required
            aria-invalid={bad('time')}
          />
        </div>
        <div class="grid gap-2">
          <Label for="keepDaily">{m.backups_keep_daily()}</Label>
          <Input
            id="keepDaily"
            name="keepDaily"
            type="number"
            min="1"
            max="60"
            value={String(o.settings.keepDaily)}
            required
            aria-invalid={bad('keepDaily')}
          />
        </div>
        <div class="grid gap-2">
          <Label for="keepWeekly">{m.backups_keep_weekly()}</Label>
          <Input
            id="keepWeekly"
            name="keepWeekly"
            type="number"
            min="0"
            max="52"
            value={String(o.settings.keepWeekly)}
            required
            aria-invalid={bad('keepWeekly')}
          />
        </div>
      </Card.Content>
      <Card.Footer>
        <Button type="submit">{m.save()}</Button>
      </Card.Footer>
    </Card.Root>
  </form>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.backups_files_title()}</Card.Title>
      <Card.Description>{m.backups_files_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if o.files.length === 0}
        <p class="text-muted-foreground text-sm">{m.backups_files_empty()}</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.backups_col_time({ timeZone: o.settings.timeZone })}</Table.Head>
              <Table.Head>{m.backups_col_kind()}</Table.Head>
              <Table.Head>{m.backups_col_size()}</Table.Head>
              <Table.Head>{m.backups_col_file()}</Table.Head>
              <Table.Head class="text-right">{m.backups_col_actions()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each o.files as file (file.name)}
              <Table.Row>
                <Table.Cell>{at(file.takenAt)}</Table.Cell>
                <Table.Cell><Badge variant="outline">{kindLabel(file.kind)}</Badge></Table.Cell>
                <Table.Cell>{formatBytes(file.bytes)}</Table.Cell>
                <Table.Cell class="font-mono text-xs" dir="ltr">{file.name}</Table.Cell>
                <Table.Cell class="text-right">
                  <div class="flex justify-end gap-2">
                    <a
                      href={`/settings/backups/${file.name}`}
                      class={buttonVariants({ variant: 'outline', size: 'sm' })}
                      data-sveltekit-reload
                      download
                    >
                      <DownloadIcon class="size-4" />
                      {m.backups_download()}
                    </a>
                    <form
                      method="POST"
                      action="?/delete"
                      use:enhance
                      onsubmit={confirmDelete(file.name)}
                    >
                      <input type="hidden" name="name" value={file.name} />
                      <Button
                        type="submit"
                        variant="ghost"
                        size="sm"
                        aria-label={m.backups_delete()}
                      >
                        <Trash2Icon class="size-4" />
                      </Button>
                    </form>
                  </div>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2">
        {m.backups_runs_title()}
        {#if running}
          <Badge variant="secondary">{m.backups_status_running()}</Badge>
        {/if}
      </Card.Title>
      <Card.Description>{m.backups_runs_hint()}</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if o.runs.length === 0}
        <p class="text-muted-foreground text-sm">{m.backups_runs_empty()}</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.backups_col_time({ timeZone: o.settings.timeZone })}</Table.Head>
              <Table.Head>{m.backups_col_kind()}</Table.Head>
              <Table.Head>{m.backups_col_status()}</Table.Head>
              <Table.Head>{m.backups_col_duration()}</Table.Head>
              <Table.Head>{m.backups_col_size()}</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each o.runs as run (run.id)}
              <Table.Row>
                <Table.Cell>{at(run.startedAt)}</Table.Cell>
                <Table.Cell>
                  {kindLabel(run.kind)}
                  {#if run.attempt > 0}
                    <span class="text-muted-foreground text-xs">
                      · {m.backups_attempt({ n: String(run.attempt) })}
                    </span>
                  {/if}
                </Table.Cell>
                <Table.Cell class="max-w-sm whitespace-normal">
                  {#if run.status === 'succeeded'}
                    {m.backups_status_succeeded()}
                    {#if run.removed.length > 0}
                      <span class="text-muted-foreground text-xs">
                        · {m.backups_removed({ count: String(run.removed.length) })}
                      </span>
                    {/if}
                  {:else if run.status === 'running'}
                    {m.backups_status_running()}
                  {:else}
                    <span class="text-destructive">{m.backups_status_failed()}</span>
                    {#if run.error}
                      <div class="text-muted-foreground font-mono text-xs break-words" dir="ltr">
                        {run.error}
                      </div>
                    {/if}
                  {/if}
                </Table.Cell>
                <Table.Cell>{duration(run.startedAt, run.finishedAt)}</Table.Cell>
                <Table.Cell>{run.bytes === null ? '—' : formatBytes(run.bytes)}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>
</div>
