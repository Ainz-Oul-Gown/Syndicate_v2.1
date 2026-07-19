import { startRegistration } from "@simplewebauthn/browser";
import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import {
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
  History,
  Calendar,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import CurrenciesScreen from './CurrenciesScreen';
import DevicesScreen from './DevicesScreen';
import StorageScreen from './StorageScreen';
import AiScreen from './AiScreen';
import { applyTheme } from '../lib/theme';
import { supabaseClient } from '../lib/supabase';
import * as idbKeyval from 'idb-keyval';

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

const THEME_COLORS = ['#0A84FF', '#FF2D55', '#32D74B', '#BF5AF2'];

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
  const [activeScreen, setActiveScreen] = useState<'main' | 'currencies' | 'devices' | 'storage' | 'ai'>('main');
  const [accentColor, setAccentColor] = useState('#0A84FF');
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
  const [nameBlockedMsLeft, setNameBlockedMsLeft] = useState<number | null>(null);

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
    // Read theme color
    const savedColor = localStorage.getItem('synd_theme_color') || '#0A84FF';
    setAccentColor(savedColor);

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

          // Start Passkey Registration in browser with smart biometric optimization and robust fallbacks
          let attResp;
          try {
            // Attempt 1: Smart adaptation (Require Resident Key and User Verification, remove strict platform attachment to bypass Android Chrome bugs)
            const adaptedOptions = JSON.parse(JSON.stringify(options));
            if (adaptedOptions.authenticatorSelection) {
              adaptedOptions.authenticatorSelection.residentKey = 'required';
              adaptedOptions.authenticatorSelection.requireResidentKey = true;
              adaptedOptions.authenticatorSelection.userVerification = 'required';
              // Remove 'platform' constraint so Chrome displays a friendly native system selector where 
              // "This Device / Screen Lock" (Fingerprint) is available as the primary secure choice.
              delete adaptedOptions.authenticatorSelection.authenticatorAttachment;
            }
            attResp = await startRegistration({ optionsJSON: adaptedOptions });
          } catch (e1: any) {
            console.warn('Smart WebAuthn registration failed in settings, trying direct platform fallback...', e1);
            try {
              // Attempt 2: Direct platform mode (Force system authenticator)
              const platformOptions = JSON.parse(JSON.stringify(options));
              if (platformOptions.authenticatorSelection) {
                platformOptions.authenticatorSelection.authenticatorAttachment = 'platform';
                platformOptions.authenticatorSelection.residentKey = 'preferred';
                platformOptions.authenticatorSelection.userVerification = 'preferred';
              }
              attResp = await startRegistration({ optionsJSON: platformOptions });
            } catch (e2: any) {
              console.warn('Platform WebAuthn registration failed in settings, trying server-side default options...', e2);
              try {
                // Attempt 3: Standard options returned from server
                attResp = await startRegistration({ optionsJSON: options });
              } catch (e3: any) {
                throw new Error('Регистрация Passkey не удалась. Убедитесь, что на вашем устройстве настроен отпечаток пальца или графический ключ для разблокировки экрана, а в Chrome включено автозаполнение паролей. Ошибка: ' + e3.message);
              }
            }
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

          // Export active keys from IndexedDB to store locally for passkey usage since
          // Passkeys only authenticate, they don't derive encryption keys directly
          const rsaKey = await idbKeyval.get<CryptoKey>(`my_private_key_${userId}`);
          const ecdsaKey = await idbKeyval.get<CryptoKey>(`my_sign_key_${userId}`);

          let localVault = null;
          const simulatedSeed = `passkey security node ${userName.trim().toLowerCase()} ${userId}`;
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

  if (activeScreen === 'currencies') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 p-4 sm:p-6 overflow-y-auto">
        <CurrenciesScreen userId={userId} onBack={() => setActiveScreen('main')} />
      </div>
    );
  }

  if (activeScreen === 'devices') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 p-4 sm:p-6 overflow-y-auto">
        <DevicesScreen userId={userId} onBack={() => setActiveScreen('main')} />
      </div>
    );
  }

  if (activeScreen === 'storage') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 p-4 sm:p-6 overflow-y-auto">
        <StorageScreen onBack={() => setActiveScreen('main')} />
      </div>
    );
  }

  if (activeScreen === 'ai') {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-950 p-4 sm:p-6 overflow-y-auto">
        <AiScreen onBack={() => setActiveScreen('main')} worker={worker} />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[1000] bg-slate-950/95 backdrop-blur-3xl flex flex-col select-none animate-fade-in text-slate-100 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center px-4 sm:px-6 py-4 border-b border-slate-900 shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 rounded-full bg-slate-900 border border-slate-800/80 flex items-center justify-center text-slate-400 hover:text-slate-200 transition-all duration-200 hover:scale-105 active:scale-95 focus:outline-none"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="font-bold font-display text-slate-200 text-lg tracking-tight">Настройки</span>
        <div className="w-10 h-10" />
      </div>

      {/* Scrollable Content */}
      <div className="flex-grow overflow-y-auto px-4 sm:px-6 py-6 scrollbar-none">
        <div className="flex flex-col gap-6.5 max-w-md mx-auto w-full pb-10">
        {/* User profile & cryptographic cipher */}
        <div className="bg-gradient-to-br from-slate-900/80 to-slate-950/80 border border-slate-900 rounded-2xl p-4 sm:p-5 relative overflow-hidden shadow-xl flex flex-col gap-4">
          <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
          
          {isEditingName ? (
            <div className="flex flex-col gap-2 w-full animate-fade-in z-10">
              <span className="text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase pl-1">Редактирование имени</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => { setNameError(null); setNewName(e.target.value); }}
                  placeholder="Новое имя..."
                  className="flex-grow bg-slate-950 border border-slate-800 text-slate-100 rounded-xl px-3 py-2 text-sm outline-none focus:border-primary/60"
                  maxLength={25}
                />
                <button
                  onClick={handleSaveName}
                  className="bg-primary hover:bg-primary-hover text-white font-bold text-xs px-3.5 py-2 rounded-xl transition active:scale-95 cursor-pointer"
                >
                  ОК
                </button>
                <button
                  onClick={() => setIsEditingName(false)}
                  className="bg-slate-900 border border-slate-800 hover:text-slate-300 text-slate-400 text-xs px-3 py-2 rounded-xl transition active:scale-95 cursor-pointer"
                >
                  Отмена
                </button>
              </div>
              {nameError && (
                <span className="text-[10px] text-rose-400 font-semibold pl-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> {nameError}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4 z-10">
              <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-primary to-emerald-500 text-white font-bold text-lg flex items-center justify-center uppercase shadow-md shadow-primary/10 select-none">
                {userName ? userName.charAt(0) : '?'}
              </div>
              <div className="flex flex-col min-w-0 flex-grow">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-100 text-base truncate">{userName}</span>
                  <button
                    onClick={handleStartEditName}
                    className="text-slate-500 hover:text-slate-300 transition p-1 cursor-pointer"
                    title="Изменить имя"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-1.5 mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                  <span className="text-[10px] text-primary font-mono tracking-wider font-semibold uppercase">
                    Канал защищен
                  </span>
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-slate-900/80 pt-3.5 space-y-2.5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase">Мой ID</span>
              <div className="flex items-center justify-between bg-slate-950/60 rounded-xl px-3 py-2 border border-slate-900/80">
                <span className="text-xs text-slate-300 font-mono font-bold">{userId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(userId.toString());
                    setCopiedId(true);
                    setTimeout(() => setCopiedId(false), 2000);
                    hapticImpact("success");
                  }}
                  className="text-slate-500 hover:text-primary transition active:scale-90 p-1 cursor-pointer"
                  title="Копировать ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {myFingerprint && (
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-slate-500 font-bold font-mono tracking-wider uppercase flex items-center gap-1">
                  <Fingerprint className="w-3 h-3 text-slate-400" />
                  Шифр Устройства
                </span>
                <div className="text-[10px] text-slate-400 font-mono bg-slate-950/40 border border-slate-900/60 rounded-xl p-2.5 px-3 break-all select-all leading-relaxed tracking-tight">
                  {myFingerprint}
                </div>
              </div>
            )}
            
            {/* Cryptosystem Stats */}
            <div className="border-t border-slate-900/40 pt-2.5 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Шифрование:</span>
                <span className="font-mono text-slate-300 flex items-center gap-1 font-bold">
                  <Lock className="w-3 h-3 text-primary" /> AES-GCM
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Цифр. подпись:</span>
                <span className="font-mono text-slate-300 flex items-center gap-1 font-bold">
                  <ShieldCheck className="w-3 h-3 text-primary" /> ECDSA-P256
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Style and Feedback */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 px-1">
            ОФОРМЛЕНИЕ И ОТКЛИК
          </h3>

          <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
            {/* Color picker */}
            <div className="flex items-center justify-between p-4 bg-slate-900/10">
              <div className="flex items-center gap-3 text-slate-300">
                <Palette className="w-4.5 h-4.5 text-primary" />
                <span className="text-sm font-medium">Цвет интерфейса</span>
              </div>
              <div className="flex gap-3">
                {THEME_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => handleColorSelect(color)}
                    style={{ backgroundColor: color }}
                    className={`w-6 h-6 rounded-full border-2 transition duration-200 active:scale-90 cursor-pointer ${
                      accentColor === color ? 'border-white scale-110 shadow-lg' : 'border-transparent'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Haptic toggle */}
            <div className="flex items-center justify-between p-4 bg-slate-900/10">
              <div className="flex items-center gap-3 text-slate-300">
                <Smartphone className="w-4.5 h-4.5 text-slate-400" />
                <span className="text-sm font-medium">Тактильный отклик (Haptics)</span>
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

        {/* Primary Settings */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 px-1">
            АКТИВЫ И СВЯЗЬ
          </h3>

          <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
            {/* Currencies */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('currencies'); }}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Coins className="w-4.5 h-4.5 text-primary" />
                <span className="text-sm font-medium">Мои монеты (Эмиссия)</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>

            {/* Devices */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('devices'); }}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Smartphone className="w-4.5 h-4.5 text-primary" />
                <span className="text-sm font-medium">Устройства и сессии</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Whitelists & Invites */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 px-1">
            КОНТРОЛЬ ДОСТУПА (БЕЛЫЙ СПИСОК)
          </h3>

          <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl p-4.5 space-y-4">
            <div className="flex justify-between items-center gap-4">
              <div>
                <span className="text-xs font-bold text-slate-200 block">Коды приглашений (Инвайты)</span>
                <span className="text-[10px] text-slate-400 mt-1 block">Вы можете создать до 3 активных кодов для друзей. Каждым кодом можно воспользоваться ровно один раз.</span>
              </div>
              <button
                disabled={myInvites.length >= 3}
                onClick={handleGenerateInvite}
                className="py-2.5 px-3 bg-primary hover:bg-primary-hover disabled:bg-slate-900/80 disabled:text-slate-600 text-white font-bold text-xs rounded-xl transition active:scale-95 shrink-0 select-none cursor-pointer"
              >
                Создать
              </button>
            </div>

            {myInvites.length > 0 ? (
              <div className="space-y-2 pt-3 border-t border-slate-900">
                {myInvites.map((code) => (
                  <div key={code} className="flex justify-between items-center bg-slate-950/40 border border-slate-900 rounded-xl p-2.5">
                    <span className="font-mono text-xs font-bold text-amber-500 uppercase tracking-wider select-all">{code}</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(code);
                          hapticImpact("success");
                          alert("Код приглашения скопирован!");
                        }}
                        className="p-1.5 hover:bg-slate-900/60 rounded-lg text-slate-400 hover:text-slate-200 transition cursor-pointer"
                        title="Копировать код"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRevokeInvite(code)}
                        className="p-1.5 hover:bg-rose-950/20 rounded-lg text-slate-500 hover:text-rose-400 transition cursor-pointer"
                        title="Отозвать код"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-2 text-[10px] text-slate-500 font-mono">
                У ВАС НЕТ АКТИВНЫХ КОДОВ ПРИГЛАШЕНИЙ
              </div>
            )}
          </div>
        </div>

        {/* System Settings */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 px-1">
            СИСТЕМА И ИИ
          </h3>

          <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
            {/* Storage */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('storage'); }}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Database className="w-4.5 h-4.5 text-purple-400" />
                <span className="text-sm font-medium">Кэш и распределение памяти</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>

            {/* AI */}
            <button
              onClick={() => { hapticImpact("selection"); setActiveScreen('ai'); }}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Brain className="w-4.5 h-4.5 text-rose-500" />
                <span className="text-sm font-medium">Локальный нейро-модуль</span>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Security Settings */}
        <div>
          <h3 className="text-[10px] font-bold font-mono text-slate-500 uppercase tracking-widest mb-2.5 px-1">
            КРИПТО-ЗАЩИТА
          </h3>

          <div className="bg-slate-900/20 border border-slate-900/60 rounded-2xl overflow-hidden divide-y divide-slate-900">
            {/* Base PIN */}
            <button
              onClick={() => { hapticImpact("selection"); onPinSetup('normal'); }}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Key className="w-4.5 h-4.5 text-amber-500" />
                <span className="text-sm font-medium">Главный пароль авторизации</span>
              </div>
              <span className={`text-[10px] font-mono font-bold border rounded-md px-2.5 py-0.5 tracking-wide uppercase ${
                hasPin ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-900 border-slate-800 text-slate-500'
              }`}>
                {hasPin ? 'ARMED' : 'OFF'}
              </span>
            </button>

            {/* Panic PIN - only visible if base pin is configured */}
            {hasPin && (
              <button
                onClick={() => { hapticImpact("selection"); onPinSetup('panic'); }}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 active:bg-slate-900/50 transition duration-150 cursor-pointer"
              >
                <div className="flex items-center gap-3 text-slate-300">
                  <ShieldCheck className="w-4.5 h-4.5 text-rose-500" />
                  <span className="text-sm font-medium">Тревожный PIN (Уничтожение)</span>
                </div>
                <span className={`text-[10px] font-mono font-bold border rounded-md px-2.5 py-0.5 tracking-wide uppercase ${
                  hasPanicPin ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 animate-pulse' : 'bg-slate-900 border-slate-800 text-slate-500'
                }`}>
                  {hasPanicPin ? 'READY' : 'OFF'}
                </span>
              </button>
            )}

            {/* Passkeys / Biometrics */}
            <div
              onClick={handleTogglePasskey}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-slate-900/35 transition duration-150 cursor-pointer"
            >
              <div className="flex items-center gap-3 text-slate-300">
                <Fingerprint className="w-4.5 h-4.5 text-primary" />
                <span className="text-sm font-medium">Вход по Passkey (Биометрия)</span>
              </div>
              <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => { hapticImpact("selection"); setShowBiometricInfo(true); }}
                  className="p-1.5 hover:bg-slate-900 rounded-lg text-slate-500 hover:text-slate-300 transition"
                  title="Анализ безопасности биометрии"
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

            {/* Panic Button */}
            <button
              onClick={() => { hapticImpact("warning"); handlePanicWipeClick(); }}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-rose-500/5 active:bg-rose-500/10 text-rose-500 transition duration-150 cursor-pointer"
            >
              <Skull className="w-4.5 h-4.5 text-rose-500" />
              <span className="text-sm font-semibold">Экстренное стирание данных (Wipe)</span>
            </button>
            <button
              onClick={() => { hapticImpact("warning"); setShowDeactivateConfirm(true); }}
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-amber-500/5 active:bg-amber-500/10 text-amber-400 transition duration-150 cursor-pointer"
            >
              <Lock className="w-4.5 h-4.5 text-amber-400" />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">Деактивировать аккаунт</span>
                <span className="text-[10px] text-slate-500 mt-0.5">Сессии и устройства будут отозваны; следующий подтверждённый вход восстановит профиль.</span>
              </div>
            </button>
          </div>
        </div>
      </div>
      </div>

      {/* Biometric Security Info Modal Overlay */}
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
                В браузере (и PWA) стандарт WebAuthn **строго изолирует** биометрический датчик от JS-кода с целью защиты вашей приватности. Сайты не имеют технической возможности узнать, *какой именно палец* был приложен. Браузер возвращает только двоичный ответ: <span className="text-emerald-400 font-semibold">"Пользователь успешно верифицирован"</span>.
              </p>
              
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-[11px] leading-relaxed">
                <strong>Решение Syndicate:</strong>
                <br />
                Поскольку отпечаток паники аппаратно недоступен в вебе, используйте наш <strong>Тревожный PIN (Panic PIN)</strong> на экране блокировки. Ввод альтернативного PIN-кода мгновенно удаляет все ключи и переписки на устройстве.
              </div>
            </div>

            <button
              onClick={() => { hapticImpact("selection"); setShowBiometricInfo(false); }}
              className="w-full bg-primary hover:bg-primary-hover text-white font-bold font-mono py-3 rounded-2xl transition"
            >
              ПОНЯТНО
            </button>
          </div>
        </div>
      )}

      {/* Custom Panic Wipe Confirmation Overlay */}
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
                className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-slate-950 font-bold font-mono py-3.5 rounded-2xl transition"
              >
                {isDeactivating ? 'ДЕАКТИВАЦИЯ…' : 'ДЕАКТИВИРОВАТЬ'}
              </button>
              <button
                disabled={isDeactivating}
                onClick={() => setShowDeactivateConfirm(false)}
                className="w-full bg-slate-900 text-slate-300 font-bold font-mono py-3 rounded-2xl border border-slate-800 transition"
              >
                ОТМЕНИТЬ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Name Blocked Overlay with ticking timer */}
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
    </div>
  );
}
