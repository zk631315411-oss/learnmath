import { useEffect, useRef } from 'react';

import { MathfieldElement } from 'mathlive';

// 视觉公式输入框：负责 MathfieldElement 的创建/销毁与 value 双向同步。
// 独立成文件是为了控制 FormulaComposer 的行数——它同时还要编排 Tiptap 和对话框逻辑。
// onChange 用 ref 存引用：父组件重渲染时 onChange 函数对象会变，但 math-field 实例不必重建。
export default function FormulaMathField({ value, onChange, fieldRef }: {
  value: string;
  onChange: (value: string) => void;
  fieldRef: React.MutableRefObject<MathfieldElement | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const field = new MathfieldElement();
    field.className = 'formula-mathfield';
    field.smartFence = true;
    // smartMode：敲 1/2 自动变分数、x^2 自动变上标、sqrt 自动变根号——拟书写输入的核心开关
    field.smartMode = true;
    // 虚拟键盘关掉：符号入口由符号带（FormulaComposer 工具栏）接管，不再弹独立浮窗键盘
    field.mathVirtualKeyboardPolicy = 'sandboxed';
    field.value = value;
    const handleInput = () => onChangeRef.current(field.value);
    field.addEventListener('input', handleInput);
    hostRef.current?.appendChild(field);
    field.keybindings = [
      ...field.keybindings,
      { key: 'tab', ifMode: 'math', command: 'moveToNextPlaceholder' },
      { key: 'shift+tab', ifMode: 'math', command: 'moveToPreviousPlaceholder' },
    ];
    let shortcutBuffer = '';
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) {
        shortcutBuffer = '';
        return;
      }
      shortcutBuffer = `${shortcutBuffer}${event.key.toLowerCase()}`.slice(-4);
      if (shortcutBuffer !== 'sqrt') return;
      event.preventDefault();
      event.stopPropagation();
      for (let index = 0; index < 3; index += 1) field.executeCommand('deleteBackward');
      field.insert('\\sqrt{#?}', { mode: 'math', selectionMode: 'placeholder' });
      shortcutBuffer = '';
    };
    field.addEventListener('keydown', handleShortcut, { capture: true });
    fieldRef.current = field;
    return () => {
      field.removeEventListener('input', handleInput);
      field.removeEventListener('keydown', handleShortcut, { capture: true });
      field.remove();
      fieldRef.current = null;
    };
  }, [fieldRef]);

  useEffect(() => {
    if (fieldRef.current && fieldRef.current.value !== value) fieldRef.current.value = value;
  }, [fieldRef, value]);

  return <div ref={hostRef} />;
}
