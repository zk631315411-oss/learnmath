import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { loadString, saveString } from '../utils/storage';

// 暗色偏好存储键：值存 '1'（暗）/ '0'（亮），统一走 storage 的字符串读写出口；
// 采用字符串而非 loadJSON/saveJSON，与历史遗留的裸字符串键（如 threadId）格式一致，避免 JSON 包装差异
const DARK_MODE_KEY = 'learnmath_dark';

// 读取已存偏好：无记录返回 null（表示"跟随系统"），与"用户显式选了亮色"区分开。
// loadString 内部已有 try/catch 兜底，读取失败同样按"无记录"降级为跟随系统
function getSavedPreference(): boolean | null {
  const saved = loadString(DARK_MODE_KEY, null);
  if (saved === null) return null;
  return saved === '1';
}

// 初值优先级：已存偏好 > 系统 prefers-color-scheme。
// 拆成独立函数是为了能让 useState 的惰性初始化直接用它，保证首个 state 即最终主题，
// 配合 useLayoutEffect 做到"首帧即正确"，而不是先渲染一帧默认值再改
function resolveInitialDark(): boolean {
  return getSavedPreference() ?? window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// 全局暗色模式状态：localStorage 持久化 + 系统偏好跟随 + documentElement 上挂/摘 'dark' class。
// App 顶层唯一持有并消费，ThemeToggle 只接收 isDark/toggle 两个 props，避免 hook 在多个地方重复实例化
export function useDarkMode(): { isDark: boolean; toggle: () => void } {
  const [isDark, setIsDark] = useState<boolean>(resolveInitialDark);
  // 是否仍在跟随系统：初始由"是否已存手动偏好"决定，用户一旦手动切换即退出跟随
  const isFollowingSystem = useRef<boolean>(getSavedPreference() === null);
  // 记录当前订阅的媒体查询与其变化回调，供手动切换时精确摘下监听
  const mediaRef = useRef<{ media: MediaQueryList; onChange: () => void } | null>(null);

  // 用 useLayoutEffect 而非 useEffect 在浏览器首次绘制前同步切换 class：
  // 若等到 useEffect（绘制后）才挂 dark，首帧会先以浅色渲染再跳变，产生闪白；
  // classList.toggle 幂等，多次执行同一目标值不产生副作用
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
  }, [isDark]);

  // 仅在"跟随系统"状态（从未手动选择过）下订阅系统主题变化，随之实时切换；
  // 一旦用户手动切换过，则完全以手动偏好为准，系统变化不再覆盖
  useEffect(() => {
    if (!isFollowingSystem.current) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(media.matches);
    mediaRef.current = { media, onChange };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
      mediaRef.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    // 手动切换即退出系统跟随，并摘下监听，避免系统变化后与手动偏好互相覆盖
    if (isFollowingSystem.current) {
      isFollowingSystem.current = false;
      const active = mediaRef.current;
      if (active) active.media.removeEventListener('change', active.onChange);
    }
    setIsDark(prev => {
      const next = !prev;
      saveString(DARK_MODE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  return { isDark, toggle };
}
