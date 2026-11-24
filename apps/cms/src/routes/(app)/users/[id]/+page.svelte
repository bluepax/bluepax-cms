<script lang="ts">
  import { enhance } from '$app/forms';
  import * as Alert from '#lib/components/ui/alert/index.js';
  import { Badge } from '#lib/components/ui/badge/index.js';
  import { Button } from '#lib/components/ui/button/index.js';
  import * as Card from '#lib/components/ui/card/index.js';
  import { Input } from '#lib/components/ui/input/index.js';
  import { Label } from '#lib/components/ui/label/index.js';
  import * as Table from '#lib/components/ui/table/index.js';
  import { m } from '#lib/paraglide/messages.js';
  import { errorText, formatDate, selectClass } from '#lib/ui.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();
  const user = $derived(data.user);

  const notice = $derived.by(() => {
    if (form?.error) return { error: true, text: errorText(form.error) };
    const saved = form && 'saved' in form ? form.saved : data.created ? 'users.create' : null;
    const texts: Record<string, string> = {
      'users.create': m.users_created(),
      'users.update': m.saved(),
      'users.disable': m.users_disabled_done(),
      'users.enable': m.users_enabled_done(),
      'users.unlock': m.users_unlocked(),
      'users.password_reset': m.users_password_reset(),
    };
    return saved && texts[saved] ? { error: false, text: texts[saved] } : null;
  });
</script>

<svelte:head>
  <title>{user.displayName} · {m.app_name()}</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
  <a href="/users" class="text-muted-foreground text-sm">← {m.users_title()}</a>
  <h1 class="text-2xl font-semibold">{user.displayName}</h1>
  {#if user.disabledAt}<Badge variant="secondary">{m.users_disabled()}</Badge>{/if}
  {#if user.locked}<Badge variant="destructive">{m.users_locked()}</Badge>{/if}
</div>

{#if notice}
  <Alert.Root variant={notice.error ? 'destructive' : 'default'} class="mb-6 max-w-2xl">
    <Alert.Description>{notice.text}</Alert.Description>
  </Alert.Root>
{/if}

<div class="grid max-w-2xl gap-6">
  <Card.Root>
    <Card.Header>
      <Card.Title>{m.users_edit()}</Card.Title>
      <Card.Description>
        {user.email} · {m.users_last_login()}: {formatDate(user.lastLoginAt)}
      </Card.Description>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/update" use:enhance class="grid gap-4">
        <div class="grid gap-2">
          <Label for="displayName">{m.users_name()}</Label>
          <Input id="displayName" name="displayName" value={user.displayName} required />
        </div>
        <div class="grid gap-2">
          <Label for="roleId">{m.users_role()}</Label>
          <select
            id="roleId"
            name="roleId"
            class={selectClass}
            value={user.roleId}
            disabled={data.isSelf}
          >
            {#each data.roles as role (role.id)}
              <option value={role.id}>{role.name}</option>
            {/each}
          </select>
          {#if data.isSelf}<input type="hidden" name="roleId" value={user.roleId} />{/if}
        </div>
        <div class="grid gap-2">
          <Label for="locale">{m.users_language()}</Label>
          <select id="locale" name="locale" class={selectClass} value={user.locale}>
            <option value="zh">{m.lang_zh()}</option>
            <option value="en">{m.lang_en()}</option>
          </select>
        </div>
        <div><Button type="submit">{m.save()}</Button></div>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header>
      <Card.Title>{m.users_reset_password()}</Card.Title>
    </Card.Header>
    <Card.Content>
      <form method="POST" action="?/password" use:enhance class="flex flex-wrap items-end gap-3">
        <div class="grid min-w-64 flex-1 gap-2">
          <Label for="password">{m.users_new_password()}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autocomplete="new-password"
            minlength={12}
            required
          />
        </div>
        <Button type="submit" variant="outline">{m.users_reset_password()}</Button>
      </form>
    </Card.Content>
  </Card.Root>

  <Card.Root>
    <Card.Header class="flex flex-row items-center justify-between">
      <Card.Title>{m.users_sessions()}</Card.Title>
      {#if data.sessions.length > 0}
        <form method="POST" action="?/endAllSessions" use:enhance>
          <Button type="submit" variant="outline" size="sm">{m.users_session_end_all()}</Button>
        </form>
      {/if}
    </Card.Header>
    <Card.Content>
      {#if data.sessions.length === 0}
        <p class="text-muted-foreground text-sm">{m.users_session_none()}</p>
      {:else}
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.Head>{m.users_session_started()}</Table.Head>
              <Table.Head>{m.users_session_last_seen()}</Table.Head>
              <Table.Head>{m.users_session_ip()}</Table.Head>
              <Table.Head>{m.users_session_agent()}</Table.Head>
              <Table.Head></Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each data.sessions as session (session.id)}
              <Table.Row>
                <Table.Cell>{formatDate(session.createdAt)}</Table.Cell>
                <Table.Cell>{formatDate(session.lastSeenAt)}</Table.Cell>
                <Table.Cell>{session.ip ?? '—'}</Table.Cell>
                <Table.Cell class="max-w-48 truncate" title={session.userAgent ?? ''}>
                  {session.userAgent ?? '—'}
                </Table.Cell>
                <Table.Cell>
                  <form method="POST" action="?/endSession" use:enhance>
                    <input type="hidden" name="session" value={session.id} />
                    <Button type="submit" variant="ghost" size="sm">{m.users_session_end()}</Button>
                  </form>
                </Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      {/if}
    </Card.Content>
  </Card.Root>

  {#if !data.isSelf}
    <div class="flex flex-wrap gap-2">
      {#if user.locked}
        <form method="POST" action="?/unlock" use:enhance>
          <Button type="submit" variant="outline">{m.users_unlock()}</Button>
        </form>
      {/if}
      {#if user.disabledAt}
        <form method="POST" action="?/enable" use:enhance>
          <Button type="submit" variant="outline">{m.users_enable()}</Button>
        </form>
      {:else}
        <form method="POST" action="?/disable" use:enhance>
          <Button type="submit" variant="destructive">{m.users_disable()}</Button>
        </form>
      {/if}
    </div>
  {/if}
</div>
