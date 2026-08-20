import { useEffect } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export default function UtilityDrawer({ open, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="学习工具">
      <button type="button" aria-label="关闭学习工具" className="absolute inset-0 cursor-default bg-slate-950/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="absolute bottom-0 left-0 top-0 flex w-[min(360px,88vw)] flex-col bg-white shadow-2xl dark:bg-slate-900">
        {children}
      </aside>
    </div>
  );
}
