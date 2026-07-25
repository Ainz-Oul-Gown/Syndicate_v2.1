import { nativeStartRegistration } from "../lib/webauthn";
import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import {
  ArrowLeft,
  X,
  Palette,
  Smartphone,
  Coins,
  Database,
  Brain,
  Key,
  Skull,
  ChevronRight,
  ShieldCheck,
  Copy,
  Check,
  Fingerprint,
  Lock,
  Edit2,
  Info,
  Clock,
  Bell,
  Loader2,
  Sun,
  Moon,
  Monitor,
  Users,
  Settings,
  AlertTriangle,
} from 'lucide-react';
import CurrenciesScreen from './CurrenciesScreen';
import DevicesScreen from './DevicesScreen';
import StorageScreen from './StorageScreen';
import AiScreen from './AiScreen';
import { applyTheme, applyThemeMode, THEME_COLORS, type ThemeMode } from '../lib/theme';
import { supabaseClient } from '../lib/supabase';
import * as idbKeyval from 'idb-keyval';
import { disablePushNotifications, enablePushNotifications, getPushState, type PushState } from '../lib/pushNotifications';

/* ── helpers (unchanged) ── */

const deriveAesKeyFromSeed = async (seed: string): Promise<CryptoKey> => {
  const encoder = new TextEncoder();
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(seed),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  
  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('syndicate-v1-salt'),
      iterations: 10000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

const encryptVault = async (aesKey: CryptoKey, rsaPrivJwk: JsonWebKey, ecdsaPrivJwk: JsonWebKey): Promise<string> => {
  const encoder = new TextEncoder();
  const rawData = JSON.stringify({ rsaPrivJwk, ecdsaPrivJwk });
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    encoder.encode(rawData)
  );
  
  const payload = {
    iv: btoa(String.fromCharCode(...iv)),
    cipher: btoa(String.fromCharCode(...new Uint8Array(cipherBuffer)))
  };
  return JSON.stringify(payload);
};

const formatMsToTime = (ms: number): string => {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  
  const parts = [];
  if (days > 0) parts.push(`${days} дн.`);
  if (hours > 0) parts.push(`${hours} ч.`);
  if (minutes > 0) parts.push(`${minutes} мин.`);
  parts.push(`${seconds} сек.`);
  
  return parts.join(' ');
};

/* ── types ── */

type SubScreen = 'appearance' | 'security' | 'invites' | 'currencies' | 'devices' | 'storage' | 'ai';

interface SettingsModalProps {
  userId: number;
  userName: string;
  myFingerprint: string | null;
  onClose: () => void;
  worker: Worker | null;
  onPanicWipe: () => void;
  onPinSetup: (type: 'normal' | 'panic') => void;
  onUpdateName?: (newName: string) => void;
}

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'auto', label: 'Системная', icon: Monitor },
  { value: 'dark', label: 'Тёмная', icon: Moon },
  { value: 'light', label: 'Светлая', icon: Sun },
];

export default function SettingsModal({
  userId,
  userName,
  myFingerprint,
  onClose,
  worker,
  onPanicWipe,
  onPinSetup,
  onUpdateName,
}: SettingsModalProps) {
  const [activeScreen, setActiveScreen] = useState<SubScreen | 'main' | 'danger'>('main');
  const [accentColor, setAccentColor] = useState('#0A84FF');
  const [themeMode, setThemeMode] = useState<ThemeMode>('auto');
  const [haptics, setHaptics] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [hasPanicPin, setHasPanicPin] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [myInvites, setMyInvites] = useState<string[]>([]);
  
  // Name edit and Biometrics states
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(userName);
  const [nameError, setNameError] = useState<string | null>(null);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [showBiometricInfo, setShowBiometricInfo] = useState(false);
  const [showPanicConfirm, setShowPanicConfirm] = useState(false);
  const [showDeactivateConfirm, setShowDeactivateConfirm] = useState(false);
  const [isDeactivating, setIsDeactivating] = useState(false);
  const [showWipeDeactivateInfo, setShowWipeDeactivateInfo] = useState(false);
  const [nameBlockedMsLeft, setNameBlockedMsLeft] = useState<number | null>(null);
  const [pushState, setPushState] = useState<PushState>('default');
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    if (nameBlockedMsLeft === null) return;
    const interval = setInterval(() => {
      setNameBlockedMsLeft((prev) => {
        if (prev === null || prev <= 1000) {
          clearInterval(interval);
          return null;
        }
        return prev - 1000;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [nameBlockedMsLeft]);

  useEffect(() => {
    setNewName(userName);
  }, [userName]);

  useEffect(() => {
    void getPushState().then(setPushState);
  }, []);

  const handlePushToggle = async () => {
    if (pushBusy || pushState === 'unsupported') return;
    setPushBusy(true);
    try {
      if (pushState === 'enabled') {
        await disablePushNotifications();
      } else {
        await enablePushNotifications();
      }
      setPushState(await getPushState());
      hapticImpact('success');
    } catch (error: any) {
      setPushState(await getPushState());
      hapticImpact('error');
      alert(error?.message || 'Не удалось изменить настройки уведомлений');
    } finally {
      setPushBusy(false);
    }
  };

  useEffect(() => {
    // Read theme color
    const savedColor = localStorage.getItem('synd_theme_color') || '#0A84FF';
    setAccentColor(savedColor);

    // Read theme mode
    const savedMode = (localStorage.getItem('synd_theme_mode') as ThemeMode) || 'auto';
    setThemeMode(savedMode);

    // Read haptics
    setHaptics(localStorage.getItem('synd_haptics') !== 'off');

    // Read PIN status
    setHasPin(!!localStorage.getItem('synd_pin_hash'));
    setHasPanicPin(!!localStorage.getItem('synd_panic_pin_hash'));

    // Check passkey registration status
    const checkPasskey = async () => {
      try {
        const cred = await idbKeyval.get('syndicate_passkey_credential');
        setHasPasskey(!!cred);
      } catch (e) {
        console.error('Failed to check passkeys', e);
      }
    };
    checkPasskey();

    // Fetch invites
    const fetchStatus = async () => {
      try {
        const { data, error } = await supabaseClient
          .from('registration_invites')
          .select('code')
          .eq('owner_id', userId)
          .is('consumed_at', null)
          .order('created_at', { ascending: true });
        if (error) throw error;
        setMyInvites((data || []).map((item: any) => item.code));
      } catch (e) {
        console.error('Failed to parse user status invites', e);
      }
    };
    fetchStatus();
  }, [activeScreen, userId]);

  const handleGenerateInvite = async () => {
    if (myInvites.length >= 3) return;
    hapticImpact('success');
    try {
      const { data, error } = await supabaseClient.rpc('create_registration_invite');
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('Сервер не вернул код приглашения');
      setMyInvites(current => [...current, data]);
    } catch (error) {
      console.error(error);
      hapticImpact('error');
    }
  };

  const handleRevokeInvite = async (code: string) => {
    hapticImpact('warning');
    try {
      const { error } = await supabaseClient.rpc('revoke_registration_invite', { invite_code: code });
      if (error) throw error;
      setMyInvites(current => current.filter(item => item !== code));
    } catch (error) {
      console.error(error);
      hapticImpact('error');
    }
  };

  const handleStartEditName = () => {
    hapticImpact("selection");
    const lastChange = localStorage.getItem('synd_last_name_change');
    if (lastChange) {
      const msPassed = Date.now() - parseInt(lastChange);
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      if (msPassed < oneWeek) {
        const msLeft = oneWeek - msPassed;
        hapticImpact("error");
        setNameBlockedMsLeft(msLeft);
        return;
      }
    }
    setIsEditingName(true);
  };

  const handleSaveName = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      setNameError('Имя не может быть пустым');
      hapticImpact("error");
      return;
    }
    if (trimmed.length < 2) {
      setNameError('Имя слишком короткое');
      hapticImpact("error");
      return;
    }

    try {
      hapticImpact("medium");

        const { data: profileData, error } = await supabaseClient
            .rpc('rename_my_profile', { new_name: trimmed })
            .single();

        if (error) throw error;

        const updatedProfile = profileData as { first_name?: string } | null;
        const savedName = updatedProfile?.first_name?.trim() || trimmed;

      // Update local storage alternate name if any
      const altUser = localStorage.getItem('synd_alt_user');
      if (altUser) {
        try {
          const parsed = JSON.parse(altUser);
          parsed.first_name = savedName;
          localStorage.setItem('synd_alt_user', JSON.stringify(parsed));
        } catch (e) {}
      }

      // Record update timestamp
      localStorage.setItem('synd_last_name_change', Date.now().toString());
      
      // Trigger callback
      if (onUpdateName) {
        onUpdateName(savedName);
      }

      setIsEditingName(false);
      hapticImpact("success");
    } catch (err: any) {
      console.error(err);
      const message = String(err?.message || 'Неизвестная ошибка');
      const cooldownMatch = message.match(/name_change_cooldown:(\d+)/);
      if (cooldownMatch) {
        setNameBlockedMsLeft(Number(cooldownMatch[1]) * 1000);
        setIsEditingName(false);
      } else {
        setNameError(`Ошибка: ${message}`);
      }
      hapticImpact("error");
    }
  };

  const handleColorSelect = (color: string) => {
    setAccentColor(color);
    localStorage.setItem('synd_theme_color', color);
    applyTheme(color);
    hapticImpact("selection");
  };

  const handleThemeModeSelect = (mode: ThemeMode) => {
    setThemeMode(mode);
    localStorage.setItem('synd_theme_mode', mode);
    applyThemeMode(mode);
    hapticImpact("selection");
  };

  const handleHapticsToggle = (checked: boolean) => {
    setHaptics(checked);
    localStorage.setItem('synd_haptics', checked ? 'on' : 'off');

    hapticImpact("medium");
  };

  const handleTogglePasskey = async () => {
    hapticImpact("selection");
    if (hasPasskey) {
      if (confirm("Вы действительно хотите отключить вход по Passkey (Биометрии) на этом устройстве?")) {
        try {
          const localCredential: any = await idbKeyval.get('syndicate_passkey_credential');
          const credentialId = typeof localCredential?.credentialId === 'string' ? localCredential.credentialId : null;
          const { data, error } = await supabaseClient.functions.invoke('webauthn-remove-credential', {
            body: { credentialId, removeAll: !credentialId },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          await idbKeyval.del('syndicate_passkey_credential');
          localStorage.removeItem('synd_use_biometrics');
          setHasPasskey(false);
          hapticImpact("success");
        } catch (e: any) {
          console.error('Failed to disable passkey', e);
          alert(`Не удалось отключить Passkey: ${e?.message || 'неизвестная ошибка'}`);
        }
      }
    } else {
      if (confirm("Включить быстрый вход по Passkey (Биометрии) на этом устройстве? Это позволит разблокировать приложение по отпечатку пальца или FaceID без ввода PIN-кода.")) {
        try {
          const { data: dbUser } = await supabaseClient.from('users').select('public_key').eq('tg_id', userId).maybeSingle();
          const publicKeysPayload = dbUser ? dbUser.public_key : '{}';

          const { data: optsData, error: optsErr } = await supabaseClient.functions.invoke('webauthn-generate-registration-options', {
          body: { name: userName, stableId: userId }
        });
        if (optsErr) throw optsErr;
        const optsRes = { json: async () => optsData };
          const options = await optsRes.json();
          if (options.error) throw new Error(options.error);

          let attResp;
          try {
            attResp = await nativeStartRegistration(options, true);
          } catch (e1: any) {
            console.warn('WebAuthn registration with platform attachment failed, retrying without...', e1);
            attResp = await nativeStartRegistration(options, false);
          }

          const { data: verifyData, error: verifyErr } = await supabaseClient.functions.invoke('webauthn-verify-registration', {
          body: { 
              stableId: userId, 
              name: userName, 
              response: attResp,
              publicKeysPayload: publicKeysPayload
            }
        });
        if (verifyErr) throw verifyErr;
        const verifyRes = { json: async () => verifyData };
          
          const verification = await verifyRes.json();
          if (verification.error) throw new Error(verification.error);

          const rsaKey = await idbKeyval.get<CryptoKey>(`my_private_key_${userId}`);
          const ecdsaKey = await idbKeyval.get<CryptoKey>(`my_sign_key_${userId}`);

          let localVault = null;
          const simulatedSeed = `passkey security node ${userName.trim().toLowerCase()} ${crypto.randomUUID()}`;
          const aesKey = await deriveAesKeyFromSeed(simulatedSeed);

          if (rsaKey && ecdsaKey) {
            try {
              const rsaPrivJwk = await window.crypto.subtle.exportKey('jwk', rsaKey);
              const ecdsaPrivJwk = await window.crypto.subtle.exportKey('jwk', ecdsaKey);
              localVault = await encryptVault(aesKey, rsaPrivJwk, ecdsaPrivJwk);
            } catch (err) {
              console.error('Failed to export keys for biometric vault', err);
            }
          }

          await idbKeyval.set('syndicate_passkey_credential', {
            id: userId,
            name: userName,
            seed: simulatedSeed,
            local_vault: localVault,
            credentialId: attResp.id
          });
          localStorage.setItem('synd_use_biometrics', 'on');
          setHasPasskey(true);
          hapticImpact("success");
        } catch (e: any) {
          console.error('Failed to enable passkey', e);
          alert('Ошибка Passkey: ' + e.message);
        }
      }
    }
  };

  const handleDeactivateAccount = async () => {
    if (isDeactivating) return;
    setIsDeactivating(true);
    try {
      const { error } = await supabaseClient.rpc('deactivate_my_account');
      if (error) throw error;
      hapticImpact('warning');
      setShowDeactivateConfirm(false);
      await Promise.resolve(onPanicWipe());
    } catch (error: any) {
      console.error(error);
      alert(`Не удалось деактивировать аккаунт: ${error?.message || 'неизвестная ошибка'}`);
      hapticImpact('error');
    } finally {
      setIsDeactivating(false);
    }
  };

  const handlePanicWipeClick = () => {
    setShowPanicConfirm(true);
  };

  /* ── sub-screen routing ── */

  if (activeScreen === 'currencies') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 overflow-y-auto">
        <CurrenciesScreen userId={userId} onBack={() => setActiveScreen('main')} />
      </div>
    );
  }
  if (activeScreen === 'devices') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 overflow-y-auto">
        <DevicesScreen userId={userId} onBack={() => setActiveScreen('main')} />
      </div>
    );
  }
  if (activeScreen === 'storage') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 overflow-y-auto">
        <StorageScreen onBack={() => setActiveScreen('main')} />
      </div>
    );
  }
  if (activeScreen === 'ai') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 overflow-y-auto">
        <AiScreen onBack={() => setActiveScreen('main')} worker={worker} />
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════
     SUB-PAGE: ОФОРМЛЕНИЕ
     ════════════════════════════════════════════════════════════════════ */
  if (activeScreen === 'appearance') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col select-none animate-fade-in text-slate-100 font-sans">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-900 shrink-0">
          <button
            onClick={() => { hapticImpact("selection"); setActiveScreen('main'); }}
            className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all duration-200 active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Palette className="w-5 h-5 text-primary" />
          <span className="font-bold font-display text-slate-200 text-lg tracking-tight">Оформление</span>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto px-5 py-6 scrollbar-none">
          <div className="flex flex-col gap-6 max-w-md mx-auto w-full pb-10">
            {/* Theme mode */}
            <div>
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-3 block px-1">Тема</span>
              <div className="flex gap-2">
                {THEME_MODE_OPTIONS.map((opt) => {
                  const Icon = opt.icon;
                  const isActive = themeMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleThemeModeSelect(opt.value)}
                      className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-xs font-semibold transition-all duration-200 active:scale-95 cursor-pointer border ${
                        isActive
                          ? 'bg-primary/15 border-primary/40 text-primary shadow-sm shadow-primary/10'
                          : 'bg-slate-900/40 border-slate-900 text-slate-400 hover:text-slate-200 hover:border-slate-800'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-slate-500 mt-2 px-1">
                {themeMode === 'auto' ? 'Следует настройкам устройства' :
                 themeMode === 'dark' ? 'Тёмная тема всегда' : 'Светлая тема всегда'}
              </p>
            </div>

            {/* Accent colors */}
            <div>
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-3 block px-1">Акцентный цвет</span>
              <div className="grid grid-cols-4 gap-4">
                {THEME_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => handleColorSelect(c.hex)}
                    className="flex flex-col items-center gap-2 cursor-pointer group"
                    title={c.name}
                  >
                    <div
                      style={{ backgroundColor: c.hex }}
                      className={`w-10 h-10 rounded-full border-2 transition-all duration-200 active:scale-90 group-hover:scale-110 ${
                        accentColor === c.hex
                          ? 'border-white scale-110 shadow-lg ring-2 ring-white/20'
                          : 'border-transparent'
                      }`}
                    />
                    <span className={`text-[9px] font-mono tracking-wide transition-colors ${
                      accentColor === c.hex ? 'text-primary font-bold' : 'text-slate-500'
                    }`}>
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Haptics */}
            <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3 text-slate-300">
                  <Smartphone className="w-4.5 h-4.5 text-slate-400" />
                  <span className="text-sm font-medium">Тактильный отклик</span>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={haptics}
                    onChange={(e) => handleHapticsToggle(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-200 after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white" />
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════
     SUB-PAGE: БЕЗОПАСНОСТЬ
     ════════════════════════════════════════════════════════════════════ */
  if (activeScreen === 'security') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col select-none animate-fade-in text-slate-100 font-sans">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-900 shrink-0">
          <button
            onClick={() => { hapticImpact("selection"); setActiveScreen('main'); }}
            className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all duration-200 active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <ShieldCheck className="w-5 h-5 text-primary" />
          <span className="font-bold font-display text-slate-200 text-lg tracking-tight">Безопасность</span>
        </div>

        <div className="flex-grow overflow-y-auto px-5 py-6 scrollbar-none">
          <div className="flex flex-col gap-6 max-w-md mx-auto w-full pb-10">
            {/* Auth methods */}
            <div>
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 block px-1">Авторизация</span>
              <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
                <button
                  onClick={() => { hapticImpact("selection"); onPinSetup('normal'); }}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
                >
                  <div className="flex items-center gap-3 text-slate-300">
                    <Key className="w-4.5 h-4.5 text-amber-500" />
                    <span className="text-sm font-medium">Главный пароль</span>
                  </div>
                  <span className={`text-[10px] font-mono font-bold border rounded-md px-2.5 py-0.5 tracking-wide uppercase ${
                    hasPin ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'
                  }`}>
                    {hasPin ? 'ARMED' : 'OFF'}
                  </span>
                </button>

                {hasPin && (
                  <button
                    onClick={() => { hapticImpact("selection"); onPinSetup('panic'); }}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
                  >
                    <div className="flex items-center gap-3 text-slate-300">
                      <ShieldCheck className="w-4.5 h-4.5 text-rose-500" />
                      <span className="text-sm font-medium">Тревожный PIN</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold border rounded-md px-2.5 py-0.5 tracking-wide uppercase ${
                      hasPanicPin ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      {hasPanicPin ? 'READY' : 'OFF'}
                    </span>
                  </button>
                )}

                <div
                  onClick={handleTogglePasskey}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 transition duration-150 cursor-pointer"
                >
                  <div className="flex items-center gap-3 text-slate-300">
                    <Fingerprint className="w-4.5 h-4.5 text-primary" />
                    <span className="text-sm font-medium">Passkey (Биометрия)</span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => { hapticImpact("selection"); setShowBiometricInfo(true); }}
                      className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-300 transition cursor-pointer"
                    >
                      <Info className="w-4 h-4" />
                    </button>
                    <span className={`text-[10px] font-mono font-bold border rounded-md px-2.5 py-0.5 tracking-wide uppercase ${
                      hasPasskey ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'
                    }`}>
                      {hasPasskey ? 'ACTIVE' : 'OFF'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Crypto stats */}
            <div>
              <span className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 block px-1">Криптография</span>
              <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Шифрование</span>
                    <span className="font-mono text-slate-300 flex items-center gap-1 font-bold">
                      <Lock className="w-3 h-3 text-primary" /> AES-GCM
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Цифр. подпись</span>
                    <span className="font-mono text-slate-300 flex items-center gap-1 font-bold">
                      <ShieldCheck className="w-3 h-3 text-primary" /> ECDSA-P256
                    </span>
                  </div>
                </div>
                {myFingerprint && (
                  <div className="p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Fingerprint className="w-3 h-3 text-slate-400" />
                      <span className="text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase">Шифр устройства</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono bg-slate-950/40 border border-slate-900/60 rounded-xl p-2.5 px-3 break-all select-all leading-relaxed tracking-tight">
                      {myFingerprint}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Danger zone */}
            <div>
              <span className="text-[10px] font-bold font-mono text-rose-500/60 uppercase tracking-widest mb-2.5 block px-1">Опасная зона</span>
              <div className="bg-slate-900/20 border border-rose-500/10 rounded-2xl overflow-hidden divide-y divide-slate-900">
                <button
                  onClick={() => { hapticImpact("warning"); handlePanicWipeClick(); }}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-rose-500/5 active:bg-rose-500/10 text-rose-500 transition duration-150 cursor-pointer"
                >
                  <Skull className="w-4.5 h-4.5 text-rose-500 shrink-0" />
                  <span className="text-sm font-semibold flex-grow">Экстренное стирание</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); hapticImpact("selection"); setShowWipeDeactivateInfo(true); }}
                    className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-300 transition shrink-0 cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </button>
                <button
                  onClick={() => { hapticImpact("warning"); setShowDeactivateConfirm(true); }}
                  className="w-full flex items-center gap-3 p-4 text-left hover:bg-amber-500/5 active:bg-amber-500/10 text-amber-400 transition duration-150 cursor-pointer"
                >
                  <Lock className="w-4.5 h-4.5 text-amber-400 shrink-0" />
                  <div className="flex flex-col flex-grow min-w-0">
                    <span className="text-sm font-semibold">Деактивировать аккаунт</span>
                    <span className="text-[10px] text-slate-500 mt-0.5">Отзыв сессий + восстановление при входе</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); hapticImpact("selection"); setShowWipeDeactivateInfo(true); }}
                    className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-300 transition shrink-0 cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                  </button>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════
     SUB-PAGE: ИНВАЙТЫ
     ════════════════════════════════════════════════════════════════════ */
  if (activeScreen === 'invites') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col select-none animate-fade-in text-slate-100 font-sans">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-900 shrink-0">
          <button
            onClick={() => { hapticImpact("selection"); setActiveScreen('main'); }}
            className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all duration-200 active:scale-95 cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Users className="w-5 h-5 text-primary" />
          <span className="font-bold font-display text-slate-200 text-lg tracking-tight">Инвайты</span>
        </div>

        <div className="flex-grow overflow-y-auto px-5 py-6 scrollbar-none">
          <div className="flex flex-col gap-4 max-w-md mx-auto w-full pb-10">
            <p className="text-xs text-slate-400 px-1">
              До 3 активных кодов. Каждый код одноразовый.
            </p>

            <button
              disabled={myInvites.length >= 3}
              onClick={handleGenerateInvite}
              className="w-full py-3 bg-primary hover:bg-primary-hover disabled:bg-slate-900/80 disabled:text-slate-600 text-white font-bold text-sm rounded-2xl transition active:scale-95 select-none cursor-pointer"
            >
              Создать код
            </button>

            {myInvites.length > 0 ? (
              <div className="space-y-2">
                {myInvites.map((code) => (
                  <div key={code} className="flex justify-between items-center bg-slate-900/20 border border-slate-900/60 rounded-2xl p-3.5">
                    <span className="font-mono text-sm font-bold text-amber-500 uppercase tracking-wider select-all">{code}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(code);
                          hapticImpact("success");
                          alert("Код скопирован!");
                        }}
                        className="p-2 hover:bg-slate-900/60 rounded-xl text-slate-400 hover:text-slate-200 transition cursor-pointer"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleRevokeInvite(code)}
                        className="p-2 hover:bg-rose-950/20 rounded-xl text-slate-500 hover:text-rose-400 transition cursor-pointer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-slate-500 font-mono">
                Нет активных кодов
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ════════════════════════════════════════════════════════════════════
     MAIN SCREEN
     ════════════════════════════════════════════════════════════════════ */
  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col select-none animate-fade-in text-slate-100 font-sans">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-900 shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all duration-200 active:scale-95 cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <Settings className="w-5 h-5 text-primary" />
        <span className="font-bold font-display text-slate-200 text-lg tracking-tight">Настройки</span>
      </div>

      {/* Scrollable Content */}
      <div className="flex-grow overflow-y-auto px-5 py-6 scrollbar-none">
        <div className="flex flex-col items-center gap-5 max-w-md mx-auto w-full pb-10">

          {/* ── Profile ── */}
          <div className="flex items-center gap-4 pt-2 pb-4 w-full">
            {/* Avatar — left */}
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-primary via-primary/80 to-emerald-500 text-white font-bold text-2xl flex items-center justify-center uppercase shadow-xl shadow-primary/20 select-none ring-3 ring-slate-900/60 shrink-0">
              {userName ? userName.charAt(0) : '?'}
            </div>

            {/* Name + ID + status — right */}
            <div className="flex flex-col min-w-0 flex-grow">
              {/* Name with edit */}
              {isEditingName ? (
                <div className="flex flex-col gap-2 animate-fade-in">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newName}
                      onChange={(e) => { setNameError(null); setNewName(e.target.value); }}
                      placeholder="Новое имя..."
                      className="flex-grow bg-slate-900 border border-slate-800 text-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60 min-w-0"
                      maxLength={25}
                    />
                    <button
                      onClick={handleSaveName}
                      className="bg-primary hover:bg-primary-hover text-white font-bold text-xs px-3 py-2 rounded-xl transition active:scale-95 cursor-pointer shrink-0"
                    >
                      ОК
                    </button>
                    <button
                      onClick={() => setIsEditingName(false)}
                      className="bg-slate-900 border border-slate-800 hover:text-slate-300 text-slate-400 text-xs px-3 py-2 rounded-xl transition active:scale-95 cursor-pointer shrink-0"
                    >
                      Отмена
                    </button>
                  </div>
                  {nameError && (
                    <span className="text-[10px] text-rose-400 font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {nameError}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100 text-lg tracking-tight truncate">{userName}</span>
                  <button
                    onClick={handleStartEditName}
                    className="text-slate-500 hover:text-slate-300 transition p-1 cursor-pointer shrink-0"
                    title="Изменить имя"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* ID — tap to copy */}
              {!isEditingName && (
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(userId.toString());
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                    hapticImpact("success");
                  }}
                  className="flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition cursor-pointer active:scale-95 mt-0.5"
                >
                  <span className="text-[11px] font-mono font-bold">{userId}</span>
                  {copiedId ? <Check className="w-3 h-3 text-primary" /> : <Copy className="w-3 h-3" />}
                </button>
              )}

              {/* Status */}
              <div className="flex items-center gap-1.5 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                <span className="text-[10px] text-primary font-mono tracking-wider font-semibold uppercase">
                  Канал защищен
                </span>
              </div>
            </div>
          </div>

          {/* ── Menu List ── */}
          <div className="w-full bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900/60">
            {/* Оформление */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('appearance'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Palette className="w-4.5 h-4.5 text-primary" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Оформление</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>

            {/* Безопасность */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('security'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Безопасность</span>
              <div className="flex items-center gap-2">
                {(hasPin || hasPasskey) && (
                  <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                    {hasPin && hasPasskey ? '2 ON' : '1 ON'}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </div>
            </button>

            {/* Мои монеты */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('currencies'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Coins className="w-4.5 h-4.5 text-amber-400" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Мои монеты</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>

            {/* Устройства */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('devices'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                <Smartphone className="w-4.5 h-4.5 text-blue-400" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Устройства</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>

            {/* Уведомления — inline toggle */}
            <div className="flex items-center gap-3.5 p-4">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                <Bell className="w-4.5 h-4.5 text-amber-400" />
              </div>
              <div className="flex-grow min-w-0">
                <span className="text-sm font-medium text-slate-200 block">Уведомления</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">
                  {pushState === 'unsupported' ? 'Не поддерживаются' :
                   pushState === 'denied' ? 'Заблокированы' :
                   pushState === 'enabled' ? 'Активны' : 'Выкл.'}
                </span>
              </div>
              {pushBusy ? <Loader2 className="w-4 h-4 animate-spin text-primary" /> : (
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushState === 'enabled'}
                    onChange={handlePushToggle}
                    disabled={pushBusy || pushState === 'unsupported'}
                    className="sr-only peer"
                  />
                  <div className="w-10 h-5.5 bg-slate-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-slate-200 after:rounded-full after:h-4.5 after:w-4.5 after:transition-all peer-checked:bg-emerald-500 peer-checked:after:bg-white" />
                </label>
              )}
            </div>

            {/* Инвайты */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('invites'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Users className="w-4.5 h-4.5 text-primary" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Инвайты</span>
              <div className="flex items-center gap-2">
                {myInvites.length > 0 && (
                  <span className="text-[9px] font-mono font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
                    {myInvites.length}
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-600" />
              </div>
            </button>

            {/* Кэш и память */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('storage'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <Database className="w-4.5 h-4.5 text-purple-400" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Кэш и память</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>

            {/* Нейро-модуль */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('ai'); }}
              className="w-full flex items-center gap-3.5 p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="w-9 h-9 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
                <Brain className="w-4.5 h-4.5 text-rose-500" />
              </div>
              <span className="text-sm font-medium text-slate-200 flex-grow">Нейро-модуль</span>
              <ChevronRight className="w-4 h-4 text-slate-600" />
            </button>
          </div>
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════
         MODALS (shared across sub-pages)
         ════════════════════════════════════════════════════════════════ */}

      {/* Biometric Info */}
      {showBiometricInfo && (
        <div className="fixed inset-0 z-[1100] bg-slate-950/90 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/90 p-5 rounded-3xl flex flex-col gap-4 max-w-sm w-full mx-auto relative shadow-2xl overflow-y-auto max-h-[85vh] scrollbar-thin">
            <h3 className="font-extrabold font-mono tracking-tight text-slate-100 text-base uppercase flex items-center gap-2">
              <Fingerprint className="w-5 h-5 text-primary" /> Анализ ИБ: Биометрия
            </h3>
            
            <div className="space-y-3.5 text-xs text-slate-300 leading-relaxed">
              <p>
                <strong className="text-primary">1. Насколько это безопасно?</strong>
                <br />
                Вход по Passkeys (WebAuthn) невероятно надежен. Ключи генерируются аппаратно в защищенном чипе Secure Enclave вашего устройства. Ни сервер, ни провайдер не видят ваши биометрические данные. Устройство передает лишь криптографическую подпись, защищая вас от фишинга и перехвата паролей.
              </p>
              
              <p>
                <strong className="text-rose-400">2. Почему невозможен "Отпечаток паники" (Panic Fingerprint) в Web?</strong>
                <br />
                В браузере (и PWA) стандарт WebAuthn строго изолирует биометрический датчик от JS-кода с целью защиты вашей приватности. Сайты не имеют технической возможности узнать, какой именно палец был приложен. Браузер возвращает только двоичный ответ: <span className="text-emerald-400 font-semibold">"Пользователь успешно верифицирован"</span>.
              </p>
              
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] leading-relaxed">
                <strong>Решение Syndicate:</strong>
                <br />
                Поскольку отпечаток паники аппаратно недоступен в вебе, используйте наш <strong>Тревожный PIN (Panic PIN)</strong> на экране блокировки. Ввод альтернативного PIN-кода мгновенно удаляет все ключи и переписки на устройстве.
              </div>
            </div>

            <button
              onClick={() => { hapticImpact("selection"); setShowBiometricInfo(false); }}
              className="w-full bg-primary hover:bg-primary-hover text-white font-bold font-mono py-3 rounded-2xl transition cursor-pointer"
            >
              ПОНЯТНО
            </button>
          </div>
        </div>
      )}

      {/* Wipe Confirmation */}
      {showPanicConfirm && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/95 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
          <div className="bg-gradient-to-b from-rose-950/30 to-slate-950 border border-rose-500/30 p-6 rounded-3xl flex flex-col gap-5 max-w-sm w-full mx-auto relative shadow-2xl shadow-rose-950/20">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-500 mx-auto">
              <Skull className="w-6 h-6 animate-pulse" />
            </div>
            
            <div className="text-center">
              <h3 className="font-extrabold font-mono tracking-tight text-rose-500 text-base uppercase">
                Экстренное стирание
              </h3>
              <p className="text-[11px] text-rose-400/80 font-mono mt-1">КРИТИЧЕСКАЯ ОПЕРАЦИЯ (PANIC WIPE)</p>
            </div>
            
            <div className="space-y-3.5 text-xs text-slate-300 leading-relaxed">
              <p className="text-center text-[11px] text-slate-400">
                Данное действие мгновенно сотрет локальный профиль и криптографические ключи на этом устройстве.
              </p>
              
              <div className="bg-rose-500/5 border border-rose-500/10 rounded-2xl p-4 space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-400 shrink-0 select-none">✦</span>
                  <p className="text-[11px]">Будут удалены все <b>сессионные ключи шифрования</b> (RSA-2048, ECDSA, AES-GCM).</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-400 shrink-0 select-none">✦</span>
                  <p className="text-[11px]">Локальный кэш чатов, сообщений и медиафайлов сотрется безвозвратно.</p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="text-rose-400 shrink-0 select-none">✦</span>
                  <p className="text-[11px]">Сессии авторизации (включая Google OAuth и куки) будут полностью сброшены.</p>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => { hapticImpact("warning"); setShowPanicConfirm(false); onPanicWipe(); }}
                className="w-full bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold font-mono py-3.5 rounded-2xl transition shadow-lg shadow-rose-650/15 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Skull className="w-4 h-4" /> ПОДТВЕРДИТЬ СТИРАНИЕ
              </button>
              <button
                onClick={() => { hapticImpact("selection"); setShowPanicConfirm(false); }}
                className="w-full bg-slate-900 hover:bg-slate-850 text-slate-300 font-bold font-mono py-3 rounded-2xl border border-slate-800 transition cursor-pointer"
              >
                ОТМЕНИТЬ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation */}
      {showDeactivateConfirm && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/95 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
          <div className="bg-gradient-to-b from-amber-950/25 to-slate-950 border border-amber-500/30 p-6 rounded-3xl flex flex-col gap-5 max-w-sm w-full mx-auto shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mx-auto">
              <Lock className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="font-extrabold font-mono text-amber-400 text-base uppercase">Деактивация аккаунта</h3>
              <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                Все действующие сессии, доверенные устройства и неиспользованные приглашения будут отозваны. История зашифрованных чатов и долгов сохранится. Аккаунт восстановится после следующего успешного входа с подтверждением личности.
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              <button
                disabled={isDeactivating}
                onClick={handleDeactivateAccount}
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold font-mono py-3.5 rounded-2xl transition cursor-pointer"
              >
                {isDeactivating ? 'ДЕАКТИВАЦИЯ…' : 'ДЕАКТИВИРОВАТЬ'}
              </button>
              <button
                disabled={isDeactivating}
                onClick={() => setShowDeactivateConfirm(false)}
                className="w-full bg-slate-900 text-slate-300 font-bold font-mono py-3 rounded-2xl border border-slate-800 transition cursor-pointer"
              >
                ОТМЕНИТЬ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Name Blocked Timer */}
      {nameBlockedMsLeft !== null && (
        <div className="fixed inset-0 z-[1200] bg-slate-950/95 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 p-6 rounded-3xl flex flex-col gap-5 max-w-sm w-full mx-auto relative shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 mx-auto">
              <Clock className="w-6 h-6 animate-pulse" />
            </div>
            
            <div className="text-center">
              <h3 className="font-extrabold font-mono tracking-tight text-amber-500 text-base uppercase">
                Изменение имени ограничено
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-1">БЕЗОПАСНОСТЬ ИДЕНТИФИКАЦИИ</p>
            </div>
            
            <div className="space-y-3.5 text-xs text-slate-300 leading-relaxed text-center">
              <p className="text-[12px] text-slate-300">
                В целях защиты от подмены личности (Identity Spoofing) в Syndicate редактировать имя можно <strong>не чаще 1 раза в неделю</strong>.
              </p>
              
              <div className="bg-slate-900 border border-slate-800/80 rounded-2xl py-4 px-3 flex flex-col items-center justify-center gap-1">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-mono">До снятия блокировки осталось:</span>
                <span className="text-sm font-bold font-mono text-amber-400 tracking-wider">
                  {formatMsToTime(nameBlockedMsLeft)}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => { hapticImpact("selection"); setNameBlockedMsLeft(null); }}
                className="w-full bg-slate-800 hover:bg-slate-700 text-slate-100 font-bold font-mono py-3.5 rounded-2xl border border-slate-700 transition cursor-pointer flex items-center justify-center"
              >
                ПОНЯТНО
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Wipe vs Deactivate Info */}
      {showWipeDeactivateInfo && (
        <div className="fixed inset-0 z-[1100] bg-slate-950/90 backdrop-blur-md flex flex-col justify-center p-4 animate-fade-in font-sans">
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 border border-slate-800/90 p-5 rounded-3xl flex flex-col gap-4 max-w-sm w-full mx-auto relative shadow-2xl overflow-y-auto max-h-[85vh] scrollbar-thin">
            <h3 className="font-extrabold font-mono tracking-tight text-slate-100 text-base uppercase flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Стирание vs Деактивация
            </h3>

            <div className="space-y-3.5 text-xs text-slate-300 leading-relaxed">
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl">
                <p className="font-bold text-rose-400 mb-1.5 flex items-center gap-1.5">
                  <Skull className="w-3.5 h-3.5" /> Экстренное стирание (Wipe)
                </p>
                <p>
                  Полностью удаляет <strong>всё локально</strong> на этом устройстве: ключи шифрования, кэш чатов, медиафайлы, сессии авторизации (включая Google OAuth). Аккаунт на сервере <strong>остаётся активным</strong> — другие устройства продолжают работать.
                </p>
                <p className="mt-1.5 text-rose-400/80">
                  <strong>Сценарий:</strong> устройство утеряно или скомпрометировано.
                </p>
              </div>

              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <p className="font-bold text-amber-400 mb-1.5 flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5" /> Деактивация аккаунта
                </p>
                <p>
                  Помечает аккаунт как <strong>deactivated</strong> на сервере, <strong>отзывает все сессии</strong> на всех устройствах, удаляет устройства, инвайты и auth-челленджи. Затем выполняет полную локальную очистку (как Wipe).
                </p>
                <p className="mt-1.5 text-amber-400/80">
                  <strong>Сценарий:</strong> аккаунт скомпрометирован. Восстановление — через повторный вход с подтверждением личности.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
                <table className="w-full text-[11px]">
                  <tbody>
                    <tr className="border-b border-slate-800">
                      <td className="py-1.5 text-slate-500 font-mono"></td>
                      <td className="py-1.5 text-center font-bold text-rose-400">Wipe</td>
                      <td className="py-1.5 text-center font-bold text-amber-400">Деактивация</td>
                    </tr>
                    <tr className="border-b border-slate-800/50">
                      <td className="py-1.5 text-slate-500">Аккаунт на сервере</td>
                      <td className="py-1.5 text-center text-emerald-400">Жив</td>
                      <td className="py-1.5 text-center text-rose-400">Заблокирован</td>
                    </tr>
                    <tr className="border-b border-slate-800/50">
                      <td className="py-1.5 text-slate-500">Другие устройства</td>
                      <td className="py-1.5 text-center text-emerald-400">Работают</td>
                      <td className="py-1.5 text-center text-rose-400">Сброшены</td>
                    </tr>
                    <tr className="border-b border-slate-800/50">
                      <td className="py-1.5 text-slate-500">Восстановление</td>
                      <td className="py-1.5 text-center text-slate-300">Логин</td>
                      <td className="py-1.5 text-center text-slate-300">Логин + подтверждение</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-slate-500">Ключи E2EE</td>
                      <td className="py-1.5 text-center text-rose-400">Удалены</td>
                      <td className="py-1.5 text-center text-rose-400">Удалены</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <button
              onClick={() => { hapticImpact("selection"); setShowWipeDeactivateInfo(false); }}
              className="w-full bg-primary hover:bg-primary-hover text-white font-bold font-mono py-3 rounded-2xl transition cursor-pointer"
            >
              ПОНЯТНО
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
