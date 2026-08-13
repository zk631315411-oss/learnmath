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
    field.smartMode = false;
    field.value = value;
    const handleInput = () => onChangeRef.current(field.value);
    field.addEventListener('input', handleInput);
    hostRef.current?.appendChild(field);
    fieldRef.current = field;
    requestAnimationFrame(() => field.focus());
    return () => {
      field.removeEventListener('input', handleInput);
      field.remove();
      fieldRef.current = null;
    };
  }, [fieldRef]);

  useEffect(() => {
    if (fieldRef.current && fieldRef.current.value !== value) fieldRef.current.value = value;
  }, [fieldRef, value]);

  return <div ref={hostRef} />;
}
