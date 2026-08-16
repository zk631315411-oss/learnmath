import { Moon, Sun } from 'lucide-react';

interface Props {
  // 当前是否暗色模式，以及切换回调：主题状态由 App 顶层的 useDarkMode 统一持有，
  // 本组件保持纯展示（无状态），便于复用同时避免状态多实例分叉
  isDark: boolean;
  onToggle: () => void;
}

// header 里的主题切换小图标按钮：暗色时显示太阳（点击转亮）、亮色时显示月亮（点击转暗）。
// 尺寸/圆角与 header 其它图标按钮一致，hover 高亮在明暗两态下都用浅/深底的互补色，保证都可辨
export default function ThemeToggle({ isDark, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
      title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
      className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
    >
      {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
