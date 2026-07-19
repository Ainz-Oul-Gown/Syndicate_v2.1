import { hapticImpact } from "../lib/haptics";
import { useState, useEffect } from 'react';
import * as idbKeyval from 'idb-keyval';
import { supabaseClient } from '../lib/supabase';
import { readSessionToken } from '../lib/sessionStorage';
import { arrayBufferToBase64 } from '../lib/crypto';
import { UserDevice } from '../types';
import { Scanner } from '@yudiel/react-qr-scanner';
import { ChevronLeft, Trash2, ShieldAlert, Key, Crown, Laptop, Smartphone, Info } from 'lucide-react';

interface DevicesScreenProps {
  userId: number;
  onBack: () => void;
}

export default function DevicesScreen({ userId, onBack }: DevicesScreenProps) {
  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showRuleInfo, setShowRuleInfo] = useState(false);

  
  const handleScan = async (scannedData: string) => {
    try {
      const parsed = JSON.parse(scannedData);
      if (parsed.sessionId && parsed.publicKey) {
        setIsScanning(false);
        setLoading(true);
        // encrypt current token and master keys
        const token = readSessionToken();
        const myPrivRsa = await idbKeyval.get(`my_private_key_${userId}`);
        const myPrivEcdsa = await idbKeyval.get(`my_sign_key_${userId}`);
        
        let masterKeysJSON = '';
        if (myPrivRsa && myPrivEcdsa) {
          const rsaJwk = await window.crypto.subtle.exportKey('jwk', myPrivRsa);
          const ecdsaJwk = await window.crypto.subtle.exportKey('jwk', myPrivEcdsa);
          masterKeysJSON = JSON.stringify({ rsa: rsaJwk, ecdsa: ecdsaJwk });
        }
        
        const { data: userData } = await supabaseClient.from('users').select('tg_id, first_name, status').eq('tg_id', userId).single();
        
        const payloadObj = {
          token,
          masterKeys: masterKeysJSON,
          user: userData
        };
        
        const payloadStr = JSON.stringify(payloadObj);
        const payloadBytes = new TextEncoder().encode(payloadStr);
        
        // Import public key
        const qrPubKeyBinary = new Uint8Array(
          atob(parsed.publicKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''))
            .split('')
            .map(c => c.charCodeAt(0))
        );
        const importedPubKey = await crypto.subtle.importKey(
          'spki',
          qrPubKeyBinary,
          { name: 'RSA-OAEP', hash: 'SHA-256' },
          false,
          ['encrypt']
        );
        
        // Generate AES key for payload
        const aesKey = await crypto.subtle.generateKey(
          { name: 'AES-GCM', length: 256 },
          true,
          ['encrypt']
        );
        
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertextBuf = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          aesKey,
          payloadBytes
        );
        
        const exportedAesKey = await crypto.subtle.exportKey('raw', aesKey);
        
        const encryptedAesKeyBuf = await crypto.subtle.encrypt(
          { name: 'RSA-OAEP' },
          importedPubKey,
          exportedAesKey
        );
        
        const payloadData = {
          encKey: arrayBufferToBase64(encryptedAesKeyBuf),
          iv: arrayBufferToBase64(iv.buffer),
          cipher: arrayBufferToBase64(ciphertextBuf)
        };
        
        const channel = supabaseClient.channel(`qr-login-${parsed.sessionId}`);
        const cleanupTimer = window.setTimeout(() => { void supabaseClient.removeChannel(channel); }, 15_000);
        channel.subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.send({
              type: 'broadcast',
              event: 'auth-payload',
              payload: { data: payloadData }
            });
            alert('Устройство успешно авторизовано!');
            window.clearTimeout(cleanupTimer);
            void supabaseClient.removeChannel(channel);
          }
        });
      }
    } catch (e) {
      console.error('Scan error', e);
      // ignore invalid QR codes
    } finally {
      setLoading(false);
    }
  };

  const getDeviceId = () => {
    let did = localStorage.getItem('syndicate_device_id');
    if (!did) {
      did = 'dev_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), byte => byte.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('syndicate_device_id', did);
    }
    return did;
  };

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabaseClient
        .from('user_devices')
        .select('user_id, device_id, device_name, added_at, last_active')
        .eq('user_id', userId)
        .order('added_at', { ascending: true });

      if (error) throw error;
      setDevices(data || []);
    } catch (err: any) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, [userId]);

  const handleDeleteDevice = async (deviceId: string, deviceName: string) => {
    if (!confirm(`Точно удалить устройство "${deviceName}"? Сеанс на нем будет мгновенно завершен.`)) return;

    try {
      const { error } = await supabaseClient
        .from('user_devices')
        .delete()
        .eq('device_id', deviceId);

      if (error) throw error;

      setDevices((prev) => prev.filter((d) => d.device_id !== deviceId));

hapticImpact("success");
    } catch (err: any) {
      alert('Ошибка удаления устройства: ' + err.message);
    }
  };

  const myDeviceId = getDeviceId();
  const masterDevice = devices[0]; // Chronologically first
  const myDevice = devices.find((d) => d.device_id === myDeviceId);

  const amIMaster = myDevice && masterDevice && myDevice.device_id === masterDevice.device_id;
  const msInDay = 1000 * 3600 * 24;
  const myAgeDays = myDevice ? (Date.now() - new Date(myDevice.added_at).getTime()) / msInDay : 0;

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 select-none animate-fade-in font-sans max-w-lg mx-auto w-full px-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-900 pb-4 mb-5 px-1 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-slate-400 hover:text-slate-200 bg-slate-900/50 border border-slate-900 px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition active:scale-95 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" /> Назад
        </button>
        <span className="font-extrabold font-mono tracking-wider text-slate-300 text-xs uppercase">
          Активные сессии
        </span>
        <button
          onClick={() => { hapticImpact("selection"); setShowRuleInfo(!showRuleInfo); }}
          className={`p-1.5 rounded-lg border transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-wider ${
            showRuleInfo
              ? 'bg-primary/10 border-primary/25 text-primary'
              : 'bg-slate-900/40 border-slate-900 text-slate-400 hover:text-slate-200'
          }`}
          title="Показать справку"
        >
          <Info className="w-3.5 h-3.5" />
          <span>{showRuleInfo ? 'Скрыть' : 'Инфо'}</span>
        </button>
      </div>

      {showRuleInfo && (
        <div className="flex gap-3 text-xs leading-relaxed text-slate-400 bg-slate-900/10 border border-slate-900 p-4.5 rounded-2xl mb-5 relative overflow-hidden animate-fade-in">
          <div className="absolute top-0 right-0 p-1.5 text-[8px] text-slate-700 font-mono tracking-widest pointer-events-none select-none uppercase">
            SEC-RULE: 7D
          </div>
          <ShieldAlert className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
          <span>
            Первое устройство хронологически является <span className="text-slate-200 font-semibold">главным</span>. Новые терминалы получают полномочия на удаление других администраторов только через 7 суток.
          </span>
        </div>
      )}

      {isScanning ? (
        <div className="w-full aspect-square bg-black rounded-3xl overflow-hidden relative border-2 border-primary mb-6 glow-primary">
          <Scanner 
            onScan={(result) => {
              if (result && result.length > 0) {
                handleScan(result[0].rawValue);
              }
            }} 
          />
          <button 
            onClick={() => setIsScanning(false)}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold uppercase tracking-wider px-6 py-2.5 rounded-full shadow-lg transition active:scale-95"
          >
            Отмена
          </button>
        </div>
      ) : (
        <button 
          onClick={() => {
            hapticImpact("selection");
            setIsScanning(true);
          }}
          className="w-full bg-primary/10 border border-primary/20 text-primary hover:bg-primary hover:text-white font-semibold py-3.5 px-4 rounded-xl transition-all duration-300 mb-6 flex items-center justify-center gap-2.5 text-sm glow-primary"
        >
          <Key className="w-4.5 h-4.5" />
          Авторизовать новое устройство (QR)
        </button>
      )}

      <div className="flex-grow overflow-y-auto flex flex-col gap-3">
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : devices.length === 0 ? (
          <p className="text-slate-500 text-center py-10 text-xs font-mono tracking-wide uppercase">
            СПИСОК СЕССИЙ ПУСТ
          </p>
        ) : (
          devices.map((d, idx) => {
            const isMe = d.device_id === myDeviceId;
            const isTargetMaster = idx === 0;
            const targetAgeDays = (Date.now() - new Date(d.added_at).getTime()) / msInDay;
            const targetIsOlder = new Date(d.added_at) < new Date(myDevice?.added_at || '');

            // Rule calculation
            let canDelete = false;
            if (!isMe) {
              if (amIMaster) {
                // Master can delete anyone immediately
                canDelete = true;
              } else {
                if (targetIsOlder) {
                  // Regular device can delete older devices only if it is >= 7 days old itself
                  if (myAgeDays >= 7) canDelete = true;
                } else {
                  // Can delete younger devices immediately
                  canDelete = true;
                }
              }
            }

            const dateStr = new Date(d.added_at).toLocaleDateString();

            return (
              <div
                key={d.device_id}
                className={`flex items-center justify-between p-4 bg-slate-900/20 border rounded-2xl hover:bg-slate-900/40 transition duration-200 ${
                  isMe ? 'border-primary/40 bg-primary/5 shadow-md shadow-primary/5' : 'border-slate-900/60'
                }`}
              >
                <div className="flex items-center gap-3.5">
                  <div
                    className={`w-11 h-11 rounded-xl flex items-center justify-center border transition-all ${
                      isTargetMaster
                        ? 'bg-primary/15 text-primary border-primary/20 shadow-md shadow-primary/10'
                        : 'bg-slate-900 text-slate-400 border-slate-800'
                    }`}
                  >
                    {isTargetMaster ? <Crown className="w-5 h-5" /> : <Laptop className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="font-bold text-slate-200 text-sm flex items-center gap-2">
                      {d.device_name}
                      {isMe && (
                        <span className="text-[9px] font-mono font-bold bg-primary/20 border border-primary/30 text-primary rounded-md px-1.5 py-0.5 uppercase tracking-wide">
                          ТЕКУЩЕЕ
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono mt-1">
                      ДОБАВЛЕНО: {dateStr}
                    </div>
                  </div>
                </div>

                {canDelete ? (
                  <button
                    onClick={() => handleDeleteDevice(d.device_id, d.device_name)}
                    className="p-2.5 text-rose-500 hover:bg-rose-500/10 rounded-xl active:scale-95 transition"
                  >
                    <Trash2 className="w-4.5 h-4.5" />
                  </button>
                ) : !isMe ? (
                  <div className="p-2.5 text-slate-600 font-mono" title="Доступ ограничен">
                    <Key className="w-4.5 h-4.5" />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
