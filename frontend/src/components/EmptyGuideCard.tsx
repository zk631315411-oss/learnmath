import { BookOpen, Crop, History, type LucideIcon } from 'lucide-react';

// 三步引导的静态配置：序号、图标与文案一一对应；
// 桌面 PDF 区、移动 PDF 区、聊天面板三处空态共用同一份文案，保证视觉与语义一致
const GUIDE_STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: BookOpen, title: '选择教材', desc: '从顶部下拉菜单选择要学习的教材' },
  { icon: Crop, title: '框选题目提问', desc: '点击「框选提问」，框住不会的题目' },
  { icon: History, title: '查看提问记录', desc: '历史提问按页保存，随时回看' },
];

// 空态三步引导卡：占据整个空态区域并居中展示，向新用户说明本应用的使用路径
export default function EmptyGuideCard() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-slate-400">
      <h3 className="text-sm font-semibold text-slate-500 dark:text-slate-400">三步开始学习</h3>
      <ul className="mt-4 space-y-3">
        {GUIDE_STEPS.map((step, index) => (
          <li key={step.title} className="flex items-center gap-3">
            {/* 圆形序号：与图标、文案并列，强化步骤顺序感 */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300">
              {index + 1}
            </span>
            <step.icon className="h-5 w-5 shrink-0 text-slate-400" strokeWidth={1.5} />
            <div className="text-left">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{step.title}</p>
              <p className="text-xs text-slate-400">{step.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
