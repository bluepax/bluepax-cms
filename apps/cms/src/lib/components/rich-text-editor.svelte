<script lang="ts" module>
  import { Node, type JSONContent } from '@tiptap/core';

  /** URL of a media item for the editor's preview; the stored node only keeps the media ID. */
  export type ResolveMedia = (mediaId: string) => string | null;

  // Images are media items: the node stores the media ID, and the preview URL is looked up.
  // Pasted <img> tags from elsewhere are not turned into images.
  const MediaImage = Node.create<{ resolve: ResolveMedia }>({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addOptions() {
      return { resolve: () => null };
    },
    addAttributes() {
      return { mediaId: { default: null } };
    },
    parseHTML() {
      return [
        {
          tag: 'img[data-media-id]',
          getAttrs: (element) => ({ mediaId: element.getAttribute('data-media-id') }),
        },
      ];
    },
    renderHTML({ node }) {
      const mediaId = String(node.attrs.mediaId ?? '');
      return [
        'img',
        {
          'data-media-id': mediaId,
          src: this.options.resolve(mediaId) ?? '',
          alt: '',
          class: 'max-h-64 rounded border',
        },
      ];
    },
  });
</script>

<script lang="ts">
  // The links module only, so the block schemas (and Zod) stay out of the browser bundle.
  import { isLinkUrl } from '@bluepax/cms-blocks/links';
  import { Editor } from '@tiptap/core';
  import { TableKit } from '@tiptap/extension-table';
  import StarterKit from '@tiptap/starter-kit';
  import { onMount } from 'svelte';
  import { m } from '#lib/paraglide/messages.js';
  import MediaDialog, { type PickedMedia } from './media-dialog.svelte';

  // Rich text with semantic elements only (docs/spec/README.md chapter 3): H2–H4, paragraphs,
  // lists, tables, quotes, images and links, plus strong and emphasis. No colours, fonts,
  // alignment or HTML; the document is stored as JSON (docs/adr/0009).
  let {
    id,
    label,
    value,
    dir = 'ltr',
    lang,
    invalid = false,
    resolve,
    onchange,
    onmedia,
  }: {
    id: string;
    label: string;
    value: JSONContent;
    dir?: 'ltr' | 'rtl';
    lang?: string;
    invalid?: boolean;
    resolve: ResolveMedia;
    onchange: (value: JSONContent) => void;
    /** A media item was inserted, so the caller can show it elsewhere too. */
    onmedia?: (item: PickedMedia) => void;
  } = $props();

  let element = $state<HTMLDivElement>();
  let editor = $state<Editor>();
  let dialog = $state<MediaDialog>();
  // Bumped on every transaction so the toolbar's active states update.
  let revision = $state(0);

  onMount(() => {
    const instance = new Editor({
      element: element!,
      content: value,
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3, 4] },
          code: false,
          codeBlock: false,
          horizontalRule: false,
          strike: false,
          underline: false,
          link: {
            openOnClick: false,
            autolink: true,
            defaultProtocol: 'https',
            isAllowedUri: (url) => isLinkUrl(url),
            HTMLAttributes: { rel: null, target: null },
          },
        }),
        TableKit.configure({ table: { resizable: false } }),
        MediaImage.configure({ resolve: (mediaId) => resolve(mediaId) }),
      ],
      editorProps: {
        attributes: {
          id: `${id}-content`,
          class: 'rich-text min-h-32 px-3 py-2 outline-none',
          'aria-labelledby': `${id}-label`,
          'aria-multiline': 'true',
          role: 'textbox',
          dir,
          ...(lang && { lang }),
        },
      },
      onUpdate: ({ editor: e }) => onchange(e.getJSON()),
      onTransaction: () => {
        revision++;
      },
    });
    editor = instance;
    return () => instance.destroy();
  });

  const isActive = (name: string, attrs?: Record<string, unknown>) => {
    void revision;
    return editor?.isActive(name, attrs) ?? false;
  };
  const can = (check: (e: Editor) => boolean) => {
    void revision;
    return editor ? check(editor) : false;
  };
  const chain = () => editor!.chain().focus();

  const blockType = $derived.by(() => {
    void revision;
    for (const level of [2, 3, 4]) if (isActive('heading', { level })) return `h${level}`;
    return 'p';
  });

  function setBlockType(type: string) {
    if (type === 'p') chain().setParagraph().run();
    else
      chain()
        .setHeading({ level: Number(type.slice(1)) as 2 | 3 | 4 })
        .run();
  }

  function editLink() {
    const current = (editor?.getAttributes('link').href as string | undefined) ?? '';
    const href = window.prompt(m.rich_text_link_prompt(), current);
    if (href === null) return;
    if (href.trim() === '') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    if (!isLinkUrl(href.trim())) {
      window.alert(m.rich_text_link_invalid());
      return;
    }
    chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  }

  function insertImage(item: PickedMedia) {
    onmedia?.(item);
    chain()
      .insertContent({ type: 'image', attrs: { mediaId: item.id } })
      .run();
  }

  const button =
    'rounded px-2 py-1 text-sm hover:bg-muted disabled:opacity-40 aria-pressed:bg-muted aria-pressed:font-semibold';
</script>

<div class="grid gap-2">
  <span class="text-sm font-medium" id="{id}-label">{label}</span>
  <div
    class="bg-background rounded-md border shadow-xs"
    class:border-destructive={invalid}
    aria-invalid={invalid}
  >
    <!-- Buttons keep the editor's focus and selection (no focus change on mousedown). -->
    <div
      class="flex flex-wrap items-center gap-1 border-b p-1"
      role="toolbar"
      tabindex="-1"
      aria-label={label}
      onmousedown={(event) => {
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      {#each ['p', 'h2', 'h3', 'h4'] as type (type)}
        <button
          type="button"
          class={button}
          aria-pressed={blockType === type}
          onclick={() => setBlockType(type)}
          title={type === 'p' ? m.rich_text_paragraph() : m.rich_text_heading({ level: type[1]! })}
        >
          {type === 'p' ? m.rich_text_paragraph() : type.toUpperCase()}
        </button>
      {/each}
      <button
        type="button"
        class={button}
        aria-pressed={isActive('bold')}
        onclick={() => chain().toggleBold().run()}
        title={m.rich_text_bold()}
      >
        <strong>B</strong>
      </button>
      <button
        type="button"
        class={button}
        aria-pressed={isActive('italic')}
        onclick={() => chain().toggleItalic().run()}
        title={m.rich_text_italic()}
      >
        <em>I</em>
      </button>
      <button
        type="button"
        class={button}
        aria-pressed={isActive('link')}
        onclick={editLink}
        title={m.rich_text_link()}
      >
        {m.rich_text_link()}
      </button>
      <span class="bg-border mx-1 h-5 w-px"></span>
      <button
        type="button"
        class={button}
        aria-pressed={isActive('bulletList')}
        onclick={() => chain().toggleBulletList().run()}
      >
        {m.rich_text_bullet_list()}
      </button>
      <button
        type="button"
        class={button}
        aria-pressed={isActive('orderedList')}
        onclick={() => chain().toggleOrderedList().run()}
      >
        {m.rich_text_ordered_list()}
      </button>
      <button
        type="button"
        class={button}
        aria-pressed={isActive('blockquote')}
        onclick={() => chain().toggleBlockquote().run()}
      >
        {m.rich_text_quote()}
      </button>
      <span class="bg-border mx-1 h-5 w-px"></span>
      <button type="button" class={button} onclick={() => dialog?.open()}>
        {m.rich_text_image()}
      </button>
      {#if isActive('table')}
        <button
          type="button"
          class={button}
          disabled={!can((e) => e.can().addRowAfter())}
          onclick={() => chain().addRowAfter().run()}
        >
          {m.rich_text_table_add_row()}
        </button>
        <button
          type="button"
          class={button}
          disabled={!can((e) => e.can().addColumnAfter())}
          onclick={() => chain().addColumnAfter().run()}
        >
          {m.rich_text_table_add_column()}
        </button>
        <button
          type="button"
          class={button}
          disabled={!can((e) => e.can().deleteRow())}
          onclick={() => chain().deleteRow().run()}
        >
          {m.rich_text_table_delete_row()}
        </button>
        <button
          type="button"
          class={button}
          disabled={!can((e) => e.can().deleteColumn())}
          onclick={() => chain().deleteColumn().run()}
        >
          {m.rich_text_table_delete_column()}
        </button>
        <button type="button" class={button} onclick={() => chain().deleteTable().run()}>
          {m.rich_text_table_delete()}
        </button>
      {:else}
        <button
          type="button"
          class={button}
          onclick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          {m.rich_text_table()}
        </button>
      {/if}
      <span class="bg-border mx-1 h-5 w-px"></span>
      <button
        type="button"
        class={button}
        disabled={!can((e) => e.can().undo())}
        onclick={() => chain().undo().run()}
        title={m.rich_text_undo()}
      >
        ↶
      </button>
      <button
        type="button"
        class={button}
        disabled={!can((e) => e.can().redo())}
        onclick={() => chain().redo().run()}
        title={m.rich_text_redo()}
      >
        ↷
      </button>
    </div>
    <div bind:this={element}></div>
  </div>
</div>

<MediaDialog
  bind:this={dialog}
  id="{id}-image"
  title={m.rich_text_image()}
  kind="image"
  onselect={insertImage}
/>
