import type { Editor } from '@tiptap/core';
import type { SelectionBookmark } from '@tiptap/pm/state';
import type { RecognizedBlock } from '../../types';

export function blocksToMarkdown(blocks: RecognizedBlock[]): string {
  return blocks.map(block => block.type === 'text' ? block.text.replace(/\$/g, '\\$') : block.display_mode === 'block' ? `$$${block.latex}$$` : `$${block.latex}$`).join('');
}

export function blocksToPlainText(blocks: RecognizedBlock[]): string {
  return blocks.map(block => block.type === 'text' ? block.text : block.latex).join('');
}

export function insertRecognizedBlocks(editor: Editor, blocks: RecognizedBlock[], bookmark?: SelectionBookmark | null): boolean {
  if (bookmark) {
    try {
      const selection = bookmark.resolve(editor.state.doc);
      editor.commands.setTextSelection({ from: selection.from, to: selection.to });
    } catch {
      // A deleted/invalid bookmark falls back to the current selection.
    }
  }
  const content = blocks.map(block => block.type === 'text'
    ? { type: 'text', text: block.text }
    : { type: block.display_mode === 'block' ? 'blockMath' : 'inlineMath', attrs: { latex: block.latex } });
  return editor.chain().focus().insertContent(content).run();
}
