import { Extension, InputRule } from '@tiptap/core';

// P0：单 $ 实时公式识别。
// 调研结论：@tiptap/extension-mathematics 自带的输入规则只处理 $$…$$（且转成行内节点），
// 单 $…$ 只有在 markdown 重新解析（setContent / 粘贴）时才会成为公式节点，
// 边输入边渲染这一行为需要自定义输入规则补齐。
const MathLiveInput = Extension.create({
  name: 'mathLiveInput',

  addInputRules() {
    return [
      new InputRule({
        // 负向断言防止与 $$…$$ 互伤：左边界的上一个字符不能是 $，右边界下一个字符也不能是 $。
        // [^$\n] 保证单行内匹配，输入到一半（如 $\frac{a）因缺少闭合 $ 不命中，不会强制转换。
        find: /(?<!\$)\$([^$\n]+?)\$(?!\$)/,
        handler: ({ state, range, match }) => {
          const latex = match[1]?.trim();
          if (!latex) return;
          const inlineMath = state.schema.nodes.inlineMath;
          if (!inlineMath) return;
          state.tr.replaceWith(range.from, range.to, inlineMath.create({ latex }));
        },
      }),
    ];
  },
});

export default MathLiveInput;
