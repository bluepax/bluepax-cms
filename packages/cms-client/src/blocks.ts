// Typed blocks (docs/spec/README.md chapters 4 and 6). A page's `blocks` may contain types this
// version of `@bluepax/cms-blocks` does not know yet (a newer CMS, or a module's block): the
// frontend ignores and logs them instead of failing.
import type { BlockData, BlockKey } from '@bluepax/cms-blocks';
import { isBlockKey } from '@bluepax/cms-blocks/keys';
import type { DeliveredBlock } from './contract.ts';

/** A delivered block whose `data` is typed by its `type`. */
export type KnownBlock = {
  [K in BlockKey]: Omit<DeliveredBlock, 'type' | 'data'> & { type: K; data: BlockData<K> };
}[BlockKey];

/** The block with typed data, or null when its type is not a standard block. */
export function knownBlock(block: DeliveredBlock): KnownBlock | null {
  return isBlockKey(block.type) ? (block as KnownBlock) : null;
}
