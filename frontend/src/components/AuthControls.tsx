import type { User } from '../types';

interface Props {
  // 只需认证态相关的三个字段即可渲染，避免与 useAuth 整体耦合
  user: Pick<User, 'token' | 'username' | 'isAnonymous'>;
  onLoginClick: () => void;
  onRegisterClick: () => void;
  onLogout: () => void;
}

// 认证按钮三态合一：游客 / 已登录 / 未登录三种状态共用同一组件，
// 类名与文案逐字沿用原 App.tsx header 中的实现，保证渲染与跳转行为不变
export default function AuthControls({ user, onLoginClick, onRegisterClick, onLogout }: Props) {
  if (user.token && user.isAnonymous) {
    return (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-l border-slate-200 pl-2 dark:border-slate-700">
        <span className="text-xs text-slate-500 hidden sm:inline dark:text-slate-400">游客</span>
        <button onClick={onLoginClick} className="rounded-lg border border-[var(--lm-brand)] bg-transparent px-2.5 py-1 text-xs font-medium text-[var(--lm-brand)] transition-colors hover:bg-[var(--lm-brand)]/10">登录</button>
        <button onClick={onRegisterClick} className="rounded-lg border border-[var(--lm-border)] bg-transparent px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-[var(--lm-bg)] hidden sm:inline dark:text-slate-400">注册</button>
      </div>
    );
  }
  if (user.token) {
    return (
      <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-l border-slate-200 pl-2 dark:border-slate-700">
        <span className="text-sm font-medium text-slate-700 hidden sm:inline dark:text-slate-200">{user.username}</span>
        <button onClick={onLogout} className="rounded-lg border border-[var(--lm-border)] bg-transparent px-2.5 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-[var(--lm-bg)] dark:text-slate-400 dark:hover:text-slate-300">退出</button>
      </div>
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap border-l border-slate-200 pl-2 dark:border-slate-700">
      <button onClick={onLoginClick} className="rounded-lg border border-[var(--lm-brand)] bg-transparent px-2.5 py-1 text-sm font-medium text-[var(--lm-brand)] transition-colors hover:bg-[var(--lm-brand)]/10">登录</button>
      <button onClick={onRegisterClick} className="rounded-lg border border-[var(--lm-border)] bg-transparent px-2.5 py-1 text-sm font-medium text-slate-400 transition-colors hover:bg-[var(--lm-bg)] hidden sm:inline dark:text-slate-400">注册</button>
    </div>
  );
}
