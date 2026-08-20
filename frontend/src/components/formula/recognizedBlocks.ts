import type { Editor } from '@tiptap/core';
import { TextSelection, type SelectionBookmark } from '@tiptap/pm/state';
import type { RecognizedBlock } from '../../types';

export function blocksToMarkdown(blocks: RecognizedBlock[]): string {
  return blocks.map(block => block.type === 'text'
    ? block.text.replace(/\$/g, '\\$')
    : block.display_mode === 'block' ? `\n\n$$${block.latex}$$\n\n` : `$${block.latex}$`).join('').replace(/\n{3,}/g, '\n\n');
}

export function blocksToPlainText(blocks: RecognizedBlock[]): string {
  return blocks.map(block => block.type === 'text' ? block.text : block.display_mode === 'block' ? `\n\n${block.latex}\n\n` : block.latex).join('').replace(/\n{3,}/g, '\n\n');
}

export function insertRecognizedBlocks(editor: Editor, blocks: RecognizedBlock[], bookmark?: SelectionBookmark | null): boolean {
  if (blocks.length === 0) return false;
  let selection = TextSelection.atEnd(editor.state.doc);
  if (bookmark) {
    try {
      const resolved = bookmark.resolve(editor.state.doc);
      selection = TextSelection.create(editor.state.doc, resolved.from);
    } catch {
      selection = TextSelection.atEnd(editor.state.doc);
    }
  }
  editor.commands.setTextSelection(selection.from);
  const content = blocks.map(block => block.type === 'text'
    ? { type: 'text', text: block.text }
    : { type: block.display_mode === 'block' ? 'blockMath' : 'inlineMath', attrs: { latex: block.latex } });
  return editor.chain().focus().insertContent(content).run();
}
