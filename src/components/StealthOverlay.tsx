import { useEffect, useState } from 'react';
import { EyeOff } from 'lucide-react';

export default function StealthOverlay() {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setActive(true);
      } else {
        setActive(false);
      }
    };

    const handleBlur = () => {
      setActive(true);
    };

    const handleFocus = () => {
      setActive(false);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('focus', handleFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      id="stealth-overlay"
      className="fixed inset-0 bg-slate-950/60 backdrop-blur-2xl z-[9999999] flex flex-col items-center justify-center animate-fade-in"
    >
      <EyeOff className="w-14 h-14 text-slate-400 mb-5 animate-pulse" />
      <div className="text-slate-200 text-lg font-semibold tracking-wide select-none">
        Скрыто в целях безопасности
      </div>
    </div>
  );
}
