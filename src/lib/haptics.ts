export type HapticsPower = 'short' | 'normal' | 'long';

const POWER_LABELS: Record<HapticsPower, string> = {
  short: 'Короткая',
  normal: 'Стандартная',
  long: 'Длинная',
};

const POWER_MULTIPLIER: Record<HapticsPower, number> = {
  short: 0.5,
  normal: 1,
  long: 1.5,
};

export function getHapticsPower(): HapticsPower {
  const v = localStorage.getItem('synd_haptics_power');
  if (v === 'short' || v === 'long') return v;
  return 'normal';
}

export function setHapticsPower(power: HapticsPower) {
  localStorage.setItem('synd_haptics_power', power);
}

export function getHapticsPowerLabel(power: HapticsPower): string {
  return POWER_LABELS[power] ?? POWER_LABELS.normal;
}

export function hapticImpact(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light') {
  const isHapticsEnabled = localStorage.getItem('synd_haptics') !== 'off';
  if (!isHapticsEnabled) return;

  const tg = (window as any).Telegram?.WebApp;
  const power = getHapticsPower();
  const m = POWER_MULTIPLIER[power];

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
    if (type === 'light') navigator.vibrate(Math.round(35 * m));
    else if (type === 'medium') navigator.vibrate(Math.round(75 * m));
    else if (type === 'heavy') navigator.vibrate(Math.round(120 * m));
    else if (type === 'success') navigator.vibrate([Math.round(40 * m), Math.round(40 * m), Math.round(70 * m)]);
    else if (type === 'warning') navigator.vibrate([Math.round(60 * m), Math.round(50 * m), Math.round(60 * m)]);
    else if (type === 'error') navigator.vibrate([Math.round(80 * m), Math.round(50 * m), Math.round(80 * m), Math.round(50 * m), Math.round(120 * m)]);
    else if (type === 'selection') navigator.vibrate(Math.round(25 * m));
  }
}
