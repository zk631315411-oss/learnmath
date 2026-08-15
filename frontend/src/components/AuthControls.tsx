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
      <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
        <span className="text-xs text-slate-500 hidden sm:inline">游客</span>
        <button onClick={onLoginClick} className="text-xs text-blue-600 hover:underline">登录</button>
        <span className="text-slate-300 hidden sm:inline">|</span>
        <button onClick={onRegisterClick} className="text-xs text-slate-500 hover:underline hidden sm:inline">注册</button>
      </div>
    );
  }
  if (user.token) {
    return (
      <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
        <span className="text-sm font-medium text-slate-700 hidden sm:inline">{user.username}</span>
        <button onClick={onLogout} className="text-xs text-slate-500 hover:text-slate-600">退出</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
      <button onClick={onLoginClick} className="text-sm text-blue-600 hover:underline">登录</button>
      <span className="text-slate-300 hidden sm:inline">|</span>
      <button onClick={onRegisterClick} className="text-sm text-slate-400 hover:underline hidden sm:inline">注册</button>
    </div>
  );
}
