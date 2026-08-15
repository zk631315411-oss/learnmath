# formula

公式编辑相关组件收敛目录。

## 为什么存在

公式能力横跨「编辑器集成（TipTap 数学节点）、对话框编排、常用公式/收藏/历史、视觉输入与预览」多个层次，
此前与普通业务组件平铺在 components/ 根目录。归入本目录是为了让「公式」这一内聚主题一眼可见，
避免根目录被一组互相强依赖的文件稀释成平铺大杂烩。

## 思路要点

- FormulaComposer 是唯一对外入口（被 ChatPanel 引用），其余文件只被 FormulaComposer 依赖。
- 历史/收藏走 localStorage + 自定义事件，自包含、不膨胀 FormulaComposer。
- 行数控制是分文件的重要动机：FormulaMathField 独立成文件即为此（见其文件头注释）。
