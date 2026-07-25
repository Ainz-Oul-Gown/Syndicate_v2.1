export type HapticsPower = 'short' | 'normal' | 'long';

const POWER_MULTIPLIER: Record<HapticsPower, number> = {
  short: 0.5,
  normal: 1,
  long: 1.5,
};

/**
 * Read haptics multiplier (0.5–1.5) from localStorage.
 * Stored as a plain number string, default 1.0.
 */
export function getHapticsMultiplier(): number {
  const raw = localStorage.getItem('synd_haptics_multiplier');
  if (raw !== null) {
    const n = parseFloat(raw);
    if (!isNaN(n) && n >= 0.5 && n <= 1.5) return n;
  }
  return 1.0;
}

export function setHapticsMultiplier(value: number) {
  localStorage.setItem('synd_haptics_multiplier', Math.max(0.5, Math.min(1.5, value)).toString());
}

/** Legacy support — converts multiplier to old type for any remaining callers */
export function getHapticsPower(): HapticsPower {
  const m = getHapticsMultiplier();
  if (m <= 0.7) return 'short';
  if (m >= 1.3) return 'long';
  return 'normal';
}

export function setHapticsPower(power: HapticsPower) {
  setHapticsMultiplier(POWER_MULTIPLIER[power]);
}

/**
 * Play a short demo vibration at the current power level.
 * Used by the slider to show the user what the vibration feels like.
 */
export function hapticDemo() {
  const m = getHapticsMultiplier();
  if (!navigator.vibrate) return;
  // A distinct pattern: medium impact + short pause + success
  navigator.vibrate([
    Math.round(60 * m),
    Math.round(40 * m),
    Math.round(80 * m),
  ]);
}

export function hapticImpact(type: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection' = 'light') {
  const isHapticsEnabled = localStorage.getItem('synd_haptics') !== 'off';
  if (!isHapticsEnabled) return;

  const tg = (window as any).Telegram?.WebApp;
  const m = getHapticsMultiplier();

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
