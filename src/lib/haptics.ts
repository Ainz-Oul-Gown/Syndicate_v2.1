export function hapticImpact(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light') {
  const isHapticsEnabled = localStorage.getItem('synd_haptics') !== 'off';
  if (!isHapticsEnabled) return;

  const tg = (window as any).Telegram?.WebApp;
  
  if (tg && typeof tg.isVersionAtLeast === 'function' && tg.isVersionAtLeast('6.1') && tg.HapticFeedback) {
    if (type === 'light' || type === 'medium' || type === 'heavy') {
      tg.HapticFeedback.impactOccurred(type);
    } else if (type === 'success' || type === 'warning' || type === 'error') {
      tg.HapticFeedback.notificationOccurred(type);
    } else if (type === 'selection') {
      tg.HapticFeedback.selectionChanged();
    }
    return;
  }

  // Fallback to Web Vibration API for Android Chrome/PWA
  if (navigator.vibrate) {
    if (type === 'light') navigator.vibrate(35);
    else if (type === 'medium') navigator.vibrate(75);
    else if (type === 'heavy') navigator.vibrate(120);
    else if (type === 'success') navigator.vibrate([40, 40, 70]);
    else if (type === 'warning') navigator.vibrate([60, 50, 60]);
    else if (type === 'error') navigator.vibrate([80, 50, 80, 50, 120]);
    else if (type === 'selection') navigator.vibrate(25);
  }
}
