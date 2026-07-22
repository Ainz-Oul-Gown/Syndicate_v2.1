import { supabaseClient } from "../lib/supabase";
import { startAuthentication } from "@simplewebauthn/browser";

import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import * as idbKeyval from 'idb-keyval';
import { Lock, Unlock, UserCheck, Delete, ShieldAlert, Fingerprint } from 'lucide-react';

interface PinScreenProps {
  onSuccess: () => void;
  mode: 'unlock' | 'setup_1' | 'setup_2' | 'disable_normal' | 'disable_panic';
  type?: 'normal' | 'panic';
  onCancel?: () => void;
  triggerPanicWipe: () => void;
}

export default function PinScreen({
  onSuccess,
  mode: initialMode,
  type: initialType = 'normal',
  onCancel,
  triggerPanicWipe,
}: PinScreenProps) {
  const [mode, setMode] = useState(initialMode);
  const [type, setType] = useState(initialType);
  const [enteredPin, setEnteredPin] = useState('');
  const [tempSetupPin, setTempSetupPin] = useState('');
  const [isError, setIsError] = useState(false);
  const [isShaking, setIsShaking] = useState(false);

  const [attemptsLeft, setAttemptsLeft] = useState(() => {
    const saved = localStorage.getItem('synd_pin_attempts_left');
    return saved ? parseInt(saved, 10) : 10;
  });
  const [cooldownTime, setCooldownTime] = useState(0);
  const [isBiometricScanning, setIsBiometricScanning] = useState(false);

  const handleBiometricUnlock = async () => {
    if (cooldownTime > 0) return;
    hapticImpact("medium");
    setIsBiometricScanning(true);
    try {
      const passkeyData = await idbKeyval.get('syndicate_passkey_credential');
      if (passkeyData) {
        const { data: optsData, error: optsErr } = await supabaseClient.functions.invoke('webauthn-generate-authentication-options', {
          body: { stableId: passkeyData.id }
        });
        if (optsErr) throw optsErr;
        const optsRes = { json: async () => optsData };
        const options = await optsRes.json();
        if (options.error) throw new Error(options.error);
        
        // Start Passkey Auth in browser with adaptive user verification to prioritize fingerprint
        let asseResp;
        try {
          const adaptedOptions = JSON.parse(JSON.stringify(options));
          // Require user verification to immediately invoke the biometric/fingerprint sensor dialog on Android
          adaptedOptions.userVerification = 'required';
          asseResp = await startAuthentication({ optionsJSON: adaptedOptions });
        } catch (e1: any) {
          console.warn('Smart WebAuthn authentication failed in pin screen, trying standard options...', e1);
          try {
            asseResp = await startAuthentication({ optionsJSON: options });
          } catch (e2: any) {
            throw new Error('Авторизация Passkey отменена или не удалась: ' + e2.message);
          }
        }
        
        const { data: verifyData, error: verifyErr } = await supabaseClient.functions.invoke('webauthn-verify-authentication', {
          body: { stableId: passkeyData.id, response: asseResp }
        });
        if (verifyErr) throw verifyErr;
        const verifyRes = { json: async () => verifyData };
        
        const verification = await verifyRes.json();
        if (verification.error && /заблокирован|blocked|deleted/i.test(verification.error)) {
          localStorage.removeItem('synd_use_biometrics');
          window.dispatchEvent(new CustomEvent('syndicate:session-expired'));
          throw new Error(verification.error);
        }
        if (!verification.verified) throw new Error('Verification failed');
      } else {
        // Never treat a missing local credential as a successful biometric check.
        // The previous fallback unlocked the application after a delay without authentication.
        localStorage.removeItem('synd_use_biometrics');
        throw new Error('Passkey не зарегистрирован на этом устройстве');
      }
      setIsBiometricScanning(false);
      hapticImpact("success");
      onSuccess();
    } catch (e) {
      console.error(e);
      setIsBiometricScanning(false);
      hapticImpact("error");
    }
  };

  useEffect(() => {
    if (mode === 'unlock' && localStorage.getItem('synd_use_biometrics') === 'on' && cooldownTime <= 0) {
      const timer = setTimeout(() => {
        handleBiometricUnlock();
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [mode, cooldownTime]);

  useEffect(() => {
    setMode(initialMode);
    setType(initialType);
    setEnteredPin('');
    setTempSetupPin('');
    setIsError(false);
    setIsShaking(false);
  }, [initialMode, initialType]);

  useEffect(() => {
    if (cooldownTime > 0) {
      const timer = setTimeout(() => {
        setCooldownTime((prev) => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldownTime]);

  const legacyHashPin = async (pin: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + 'syndicate_salt');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  };

  const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  const hexToBytes = (hex: string) => new Uint8Array(hex.match(/.{1,2}/g)?.map(v => parseInt(v, 16)) || []);
  const constantTimeEqual = (a: Uint8Array, b: Uint8Array) => {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  };

  const derivePin = async (pin: string, salt: Uint8Array, iterations: number) => {
    const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, 256));
  };

  const hashPin = async (pin: string) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iterations = 310000;
    const derived = await derivePin(pin, salt, iterations);
    return `pbkdf2v2:${iterations}:${bytesToHex(salt)}:${bytesToHex(derived)}`;
  };

  const verifyPin = async (pin: string, storedHash: string | null) => {
    if (!storedHash) return false;
    if (storedHash.startsWith('pbkdf2v2:')) {
      const [, iterationsRaw, saltHex, hashHex] = storedHash.split(':');
      const iterations = Number(iterationsRaw);
      if (!Number.isSafeInteger(iterations) || iterations < 100000) return false;
      const computed = await derivePin(pin, hexToBytes(saltHex), iterations);
      return constantTimeEqual(computed, hexToBytes(hashHex));
    }
    if (storedHash.startsWith('pbkdf2:')) {
      const salt = new TextEncoder().encode('syndicate_pbkdf2_v1_salt_2026');
      const computed = await derivePin(pin, salt, 100000);
      const ok = constantTimeEqual(computed, hexToBytes(storedHash.slice('pbkdf2:'.length)));
      if (ok) {
        const upgraded = await hashPin(pin);
        if (storedHash === localStorage.getItem('synd_pin_hash')) localStorage.setItem('synd_pin_hash', upgraded);
        if (storedHash === localStorage.getItem('synd_panic_pin_hash')) localStorage.setItem('synd_panic_pin_hash', upgraded);
      }
      return ok;
    }
    const computed = await legacyHashPin(pin);
    if (computed !== storedHash) return false;
    const upgraded = await hashPin(pin);
    if (storedHash === localStorage.getItem('synd_pin_hash')) localStorage.setItem('synd_pin_hash', upgraded);
    if (storedHash === localStorage.getItem('synd_panic_pin_hash')) localStorage.setItem('synd_panic_pin_hash', upgraded);
    return true;
  };

  const handleKeyPress = async (val: string) => {
    if (cooldownTime > 0) {
      hapticImpact("warning");
      return;
    }

    // Vibrate briefly if TG API is available
    hapticImpact("light");

    if (val === 'cancel') {
      if (onCancel) onCancel();
      return;
    }

    if (val === 'del') {
      setEnteredPin((prev) => prev.slice(0, -1));
      return;
    }

    if (enteredPin.length >= 4) return;

    const newPin = enteredPin + val;
    setEnteredPin(newPin);

    if (newPin.length === 4) {
      // Process full PIN input
      if (mode === 'unlock') {
        const savedHash = localStorage.getItem('synd_pin_hash');
        const panicHash = localStorage.getItem('synd_panic_pin_hash');

        let isPanic = false;
        if (panicHash) {
          isPanic = await verifyPin(newPin, panicHash);
        }

        if (isPanic) {
          // PANIC WIPE!
          triggerPanicWipe();
          return;
        }

        const isCorrect = await verifyPin(newPin, savedHash);

        if (isCorrect) {
          localStorage.setItem('synd_pin_attempts_left', '10');
          setAttemptsLeft(10);
          hapticImpact("success");
          onSuccess();
        } else {
          const nextAttempts = attemptsLeft - 1;
          setAttemptsLeft(nextAttempts);
          localStorage.setItem('synd_pin_attempts_left', nextAttempts.toString());

          if (nextAttempts <= 0) {
            triggerPanicWipe();
            return;
          }

          let penalty = 0;
          if (nextAttempts === 7) penalty = 5;
          else if (nextAttempts === 6) penalty = 10;
          else if (nextAttempts === 5) penalty = 20;
          else if (nextAttempts === 4) penalty = 40;
          else if (nextAttempts <= 3) penalty = 60;

          if (penalty > 0) {
            setCooldownTime(penalty);
          }

          triggerShake();
        }
      } else if (mode === 'setup_1') {
        setTempSetupPin(newPin);
        setEnteredPin('');
        setMode('setup_2');
      } else if (mode === 'setup_2') {
        if (newPin === tempSetupPin) {
          const hash = await hashPin(newPin);
          if (type === 'normal') {
            localStorage.setItem('synd_pin_hash', hash);
            localStorage.setItem('synd_pin_attempts_left', '10');
          } else if (type === 'panic') {
            localStorage.setItem('synd_panic_pin_hash', hash);
          }
          hapticImpact("success");
          onSuccess();
        } else {
          triggerShake();
          setMode('setup_1');
          setTempSetupPin('');
        }
      } else if (mode === 'disable_normal') {
        const savedHash = localStorage.getItem('synd_pin_hash');
        const isCorrect = await verifyPin(newPin, savedHash);
        if (isCorrect) {
          localStorage.removeItem('synd_pin_hash');
          localStorage.removeItem('synd_panic_pin_hash'); // Disable panic too
          localStorage.removeItem('synd_pin_attempts_left');
          hapticImpact("success");
          onSuccess();
        } else {
          triggerShake();
        }
      } else if (mode === 'disable_panic') {
        const savedPanic = localStorage.getItem('synd_panic_pin_hash');
        const isCorrect = await verifyPin(newPin, savedPanic);
        if (isCorrect) {
          localStorage.removeItem('synd_panic_pin_hash');
          hapticImpact("success");
          onSuccess();
        } else {
          triggerShake();
        }
      }
    }
  };

  const triggerShake = () => {
    setIsError(true);
    setIsShaking(true);
hapticImpact("error");
    setTimeout(() => {
      setIsShaking(false);
      setEnteredPin('');
    }, 400);
  };

  const getTitle = () => {
    switch (mode) {
      case 'unlock':
        return 'Введите PIN-код';
      case 'setup_1':
        return type === 'panic' ? 'Новый ТРЕВОЖНЫЙ PIN' : 'Новый PIN-код';
      case 'setup_2':
        return 'Повторите PIN-код';
      case 'disable_normal':
        return 'Текущий PIN для отключения';
      case 'disable_panic':
        return 'Тревожный PIN для отключения';
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950 z-[99999] flex flex-col items-center justify-center pb-12 select-none animate-fade-in font-sans overflow-hidden">
      {/* Background matrix-like digital pattern */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-30 pointer-events-none" />

      {/* Top security status */}
      <div className="absolute top-4 left-0 right-0 px-6 flex justify-between text-[10px] text-slate-500 font-mono tracking-widest uppercase pointer-events-none select-none max-w-sm mx-auto">
        <span>GATEWAY: {type === 'panic' ? 'PANIC_ARMED' : 'SECURE'}</span>
        <span>CIPHER: ACTIVE</span>
      </div>

      <div className="flex flex-col items-center mb-10 relative z-10">
        <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800/80 flex items-center justify-center mb-5 shadow-xl relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent pointer-events-none" />
          {type === 'panic' ? (
            <ShieldAlert className="w-7 h-7 text-rose-500 animate-pulse" />
          ) : (
            <Lock className="w-7 h-7 text-primary" />
          )}
        </div>
        <h2 className="text-xl font-bold font-display tracking-tight text-slate-100 text-center">
          {getTitle()}
        </h2>
        <p className="text-[11px] text-slate-500 font-mono mt-1 tracking-wider">
          {type === 'panic' ? 'ТРЕВОЖНЫЙ РЕЖИМ СТИРАНИЯ' : 'ТРЕБУЕТСЯ АВТОРИЗАЦИЯ'}
        </p>
      </div>

      {/* Dots indicator */}
      <div
        className={`flex gap-5 mb-12 h-5 justify-center relative z-10 ${
          isShaking ? 'animate-shake' : ''
        }`}
      >
        {[0, 1, 2, 3].map((index) => {
          const isActive = index < enteredPin.length;
          return (
            <div
              key={index}
              className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                isActive
                  ? isError
                    ? 'bg-rose-500 border-rose-500 shadow-lg shadow-rose-500/50 scale-110'
                    : 'bg-primary border-primary shadow-lg shadow-primary/50 scale-110'
                  : 'border-slate-700 bg-transparent scale-100'
              }`}
            />
          );
        })}
      </div>

      {/* Cooldown or attempts display */}
      <div className="h-6 flex items-center justify-center mb-6 relative z-10 font-mono text-xs">
        {cooldownTime > 0 ? (
          <span className="text-rose-500 font-black animate-pulse uppercase tracking-wider">
            ВВОД ЗАБЛОКИРОВАН: {cooldownTime} СЕК
          </span>
        ) : mode === 'unlock' && attemptsLeft < 10 ? (
          <span className="text-rose-400 font-bold animate-pulse uppercase tracking-widest">
            ОСТАЛОСЬ ПОПЫТОК: {attemptsLeft} / 10
          </span>
        ) : null}
      </div>

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-5 max-w-[290px] w-full px-4 relative z-10">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
          <button
            key={num}
            onClick={() => handleKeyPress(num.toString())}
            className="w-16.5 h-16.5 rounded-2xl bg-slate-900/60 border border-slate-800/60 hover:bg-slate-900 hover:border-slate-700/80 active:scale-95 text-2xl font-bold font-mono text-slate-200 hover:text-white flex items-center justify-center transition-all duration-200 shadow-md focus:outline-none"
          >
            {num}
          </button>
        ))}

        {mode !== 'unlock' ? (
          <button
            onClick={() => handleKeyPress('cancel')}
            className="w-16.5 h-16.5 rounded-2xl text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 active:scale-95 text-xs font-semibold uppercase tracking-wider flex items-center justify-center transition focus:outline-none"
          >
            Отмена
          </button>
        ) : localStorage.getItem('synd_use_biometrics') === 'on' ? (
          <button
            onClick={handleBiometricUnlock}
            className="w-16.5 h-16.5 rounded-2xl bg-primary/10 border border-primary/20 hover:bg-primary/20 text-primary hover:text-white flex items-center justify-center transition-all duration-200 shadow-md focus:outline-none active:scale-95"
            title="Разблокировать по биометрии"
          >
            <Fingerprint className="w-7 h-7" />
          </button>
        ) : (
          <div className="w-16.5 h-16.5" />
        )}

        <button
          onClick={() => handleKeyPress('0')}
          className="w-16.5 h-16.5 rounded-2xl bg-slate-900/60 border border-slate-800/60 hover:bg-slate-900 hover:border-slate-700/80 active:scale-95 text-2xl font-bold font-mono text-slate-200 hover:text-white flex items-center justify-center transition-all duration-200 shadow-md focus:outline-none"
        >
          0
        </button>

        <button
          onClick={() => handleKeyPress('del')}
          className="w-16.5 h-16.5 rounded-2xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/5 active:scale-95 flex items-center justify-center transition focus:outline-none"
        >
          <Delete className="w-6 h-6" />
        </button>
      </div>

      {isBiometricScanning && (
        <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md z-[100000] flex flex-col items-center justify-center p-6 font-sans">
          <div className="w-24 h-24 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center mb-6 shadow-2xl relative">
            <div className="absolute inset-0 rounded-full border border-primary/60 animate-ping opacity-40" />
            <Fingerprint className="w-12 h-12 text-primary animate-pulse" />
          </div>
          <h3 className="text-lg font-bold text-slate-100 mb-1">Биометрический сенсор</h3>
          <p className="text-xs text-slate-400">Приложите палец для разблокировки</p>
        </div>
      )}

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake {
          animation: shake 0.4s ease-in-out;
        }
      `}</style>
    </div>
  );
}
