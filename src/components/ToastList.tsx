import { useContext } from 'react';
import { ToastContext } from '../context/ToastContext';

export function ToastList() {
  const { toasts } = useContext(ToastContext);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 left-0 right-0 z-[300] flex flex-col items-center gap-2 pointer-events-none px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="max-w-sm w-full px-4 py-3 rounded-xl text-sm font-semibold shadow-lg"
          style={{
            background: t.type === 'error' ? '#ef4444' : '#3b82f6',
            color: '#fff',
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
