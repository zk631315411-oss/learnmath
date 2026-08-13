interface Props {
  mode: 'login' | 'register';
  username: string;
  password: string;
  error: string;
  onUsernameChange: (v: string) => void;
  onPasswordChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onModeSwitch: () => void;
  onClose: () => void;
}

const inputClass = "w-full border border-slate-200 dark:border-slate-600 rounded-lg px-3 py-2.5 text-sm bg-white dark:bg-slate-900 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors";

export default function AuthModal({ mode, username, password, error, onUsernameChange, onPasswordChange, onSubmit, onModeSwitch, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-80 shadow-xl border border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-sm">
            {mode === 'login' ? '→' : '+'}
          </div>
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-200">{mode === 'login' ? '登录' : '注册'}</h3>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">用户名</label>
            <input type="text" value={username} onChange={(e) => onUsernameChange(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">密码</label>
            <input type="password" value={password} onChange={(e) => onPasswordChange(e.target.value)} className={inputClass} required />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="submit" className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200 dark:shadow-none">
              {mode === 'login' ? '登录' : '注册'}
            </button>
            <button type="button" onClick={onClose} className="px-4 py-2.5 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-sm hover:bg-slate-200 dark:hover:bg-slate-600 transition-colors">
              取消
            </button>
          </div>
        </form>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500 text-center">
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button onClick={onModeSwitch} className="text-blue-600 dark:text-blue-400 ml-1 hover:underline">{mode === 'login' ? '注册' : '登录'}</button>
        </p>
      </div>
    </div>
  );
}
