import { describe, expect, it } from 'vitest';
import {
  BLOCK_KEYS,
  blockMedia,
  blockSchemas,
  emptyBlockData,
  isLinkUrl,
  MODULE_BLOCKS,
  richTextSchema,
  type BlockContent,
} from './index.ts';

const image = '11111111-1111-4111-8111-111111111111';
const video = '22222222-2222-4222-8222-222222222222';

describe('blocks', () => {
  it('defines all 13 standard blocks with empty defaults', () => {
    expect(BLOCK_KEYS).toHaveLength(13);
    expect(Object.keys(blockSchemas)).toEqual([...BLOCK_KEYS]);
    for (const key of BLOCK_KEYS) expect(() => emptyBlockData(key), key).not.toThrow();
    expect(emptyBlockData('cards')).toEqual({ title: '', columns: 3, cards: [] });
    expect(MODULE_BLOCKS.catalog).toEqual(['category-entry', 'catalog-list']);
  });

  it('limits buttons, columns and unknown fields', () => {
    const hero = blockSchemas.hero;
    const button = { label: 'Go', url: '/en/start' };
    expect(hero.safeParse({ buttons: [button, button] }).success).toBe(true);
    expect(hero.safeParse({ buttons: [button, button, button] }).success).toBe(false);
    expect(hero.safeParse({ buttons: [{ label: '', url: '/x' }] }).success).toBe(false);
    expect(hero.safeParse({ html: '<script>' }).success).toBe(false);
    expect(blockSchemas.cards.safeParse({ columns: 5 }).success).toBe(false);
    expect(blockSchemas.stats.safeParse({ items: [{ value: '' }] }).success).toBe(false);
  });

  it('accepts paths, http(s), mailto and tel links only', () => {
    for (const url of ['/en/about', 'https://example.com/x', 'mailto:a@example.com', 'tel:+1555']) {
      expect(isLinkUrl(url), url).toBe(true);
    }
    for (const url of [
      '',
      'javascript:alert(1)',
      '//evil.example',
      'about us',
      'data:text/html,x',
    ]) {
      expect(isLinkUrl(url), url).toBe(false);
    }
  });

  it('lists the media a block uses', () => {
    const body = { type: 'doc', content: [{ type: 'image', attrs: { mediaId: image } }] };
    const blocks: BlockContent[] = [
      { type: 'hero', data: { ...emptyBlockData('hero'), background: video } },
      {
        type: 'text-media',
        data: { ...emptyBlockData('text-media'), image, body: richTextSchema.parse(body) },
      },
      {
        type: 'cards',
        data: {
          ...emptyBlockData('cards'),
          cards: [{ icon: image, title: '', description: '', url: '' }],
        },
      },
    ];
    expect(blocks.flatMap(blockMedia)).toEqual([
      { path: 'background', mediaId: video, kind: 'image-or-video' },
      { path: 'image', mediaId: image, kind: 'image' },
      { path: 'body', mediaId: image, kind: 'image' },
      { path: 'cards.0.icon', mediaId: image, kind: 'image' },
    ]);
  });
});

describe('rich text', () => {
  const text = (value: string, marks?: unknown[]) => ({
    type: 'text',
    text: value,
    ...(marks && { marks }),
  });
  const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

  it('keeps semantic elements and drops editor attributes', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3, id: 'x' }, content: [text('Title')] },
        paragraph(
          text('See ', [{ type: 'bold' }]),
          text('this', [
            {
              type: 'link',
              attrs: { href: '/en/a', target: '_blank', rel: 'noopener', class: null },
            },
          ]),
          { type: 'hardBreak' },
        ),
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [{ type: 'listItem', content: [paragraph(text('One'))] }],
        },
        { type: 'blockquote', content: [paragraph(text('Quote'))] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
                  content: [paragraph(text('A'))],
                },
                {
                  type: 'tableCell',
                  attrs: { colspan: 2, rowspan: 1, colwidth: null },
                  content: [paragraph()],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(richTextSchema.parse(doc)).toEqual({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 3 }, content: [text('Title')] },
        paragraph(
          text('See ', [{ type: 'bold' }]),
          text('this', [{ type: 'link', attrs: { href: '/en/a' } }]),
          { type: 'hardBreak' },
        ),
        { type: 'orderedList', content: [{ type: 'listItem', content: [paragraph(text('One'))] }] },
        { type: 'blockquote', content: [paragraph(text('Quote'))] },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', content: [paragraph(text('A'))] },
                { type: 'tableCell', attrs: { colspan: 2 }, content: [{ type: 'paragraph' }] },
              ],
            },
          ],
        },
      ],
    });
  });

  it('stores an editor document without content as empty', () => {
    expect(
      richTextSchema.parse({ type: 'doc', content: [{ type: 'paragraph', content: [] }] }),
    ).toEqual({
      type: 'doc',
      content: [],
    });
    expect(richTextSchema.parse(undefined)).toEqual({ type: 'doc', content: [] });
    // The editor's empty paragraphs around the content are dropped, those inside it stay.
    expect(
      richTextSchema.parse({
        type: 'doc',
        content: [
          { type: 'paragraph' },
          paragraph(text('a')),
          { type: 'paragraph' },
          paragraph(text('b')),
          { type: 'paragraph' },
        ],
      }),
    ).toEqual({
      type: 'doc',
      content: [paragraph(text('a')), { type: 'paragraph' }, paragraph(text('b'))],
    });
  });

  it('refuses other elements, styles, levels and links', () => {
    const refused = [
      { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [text('H1')] }] },
      { type: 'doc', content: [{ type: 'codeBlock', content: [text('x')] }] },
      {
        type: 'doc',
        content: [{ type: 'paragraph', attrs: { style: 'color:red' }, content: [text('x')] }],
      },
      {
        type: 'doc',
        content: [paragraph(text('x', [{ type: 'textStyle', attrs: { color: 'red' } }]))],
      },
      {
        type: 'doc',
        content: [paragraph(text('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]))],
      },
      { type: 'doc', content: [{ type: 'image', attrs: { mediaId: 'not-a-uuid' } }] },
      { type: 'doc', content: [{ type: 'html', html: '<b>x</b>' }] },
    ];
    for (const doc of refused)
      expect(richTextSchema.safeParse(doc).success, JSON.stringify(doc)).toBe(false);
  });

  it('refuses documents nested too deeply', () => {
    let node: unknown = paragraph(text('deep'));
    for (let i = 0; i < 20; i++) node = { type: 'blockquote', content: [node] };
    expect(richTextSchema.safeParse({ type: 'doc', content: [node] }).success).toBe(false);
  });
});
