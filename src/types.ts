export interface User {
  tg_id: number;
  first_name: string;
  public_key?: string; // JSON structure string mapping device IDs to { rsa: JsonWebKey, ecdsa: JsonWebKey }
  status?: string;
  account_state?: 'active' | 'deactivated' | 'blocked' | 'deleted';
}

export interface Friendship {
  id: string;
  requester_id: number;
  addressee_id: number;
  status: 'pending' | 'accepted';
}

export interface Chat {
  id: string;
  name: string;
  type: 'private' | 'group' | 'saved';
  friendId?: number;
  created_by?: number | null;
}

export interface ChatKey {
  id: number;
  chat_id: string;
  user_id: number;
  encrypted_key: string; // JSON mapping deviceId -> string
}

export interface Message {
  id: string;
  chat_id: string;
  sender_id: number;
  encrypted_text: string;
  encrypted_vector?: string | null;
  created_at: string;
}

export interface Currency {
  id: string;
  owner_id: number;
  name: string;
  rub_value: number;
}

export interface Debt {
  id: string;
  creditor_id: number;
  debtor_id: number;
  amount: number;
  currency: string;
  status: 'active' | 'payment_pending' | 'settled' | 'cancelled';
  created_by: number;
  settlement_requested_at?: string | null;
  settled_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface UserDevice {
  user_id: number;
  device_id: string;
  device_name: string;
  last_active: string;
  added_at: string;
}

export interface DeviceRequest {
  id: string;
  user_id: number;
  device_name: string;
  requester_device_id?: string;
  temp_pub_key: string; // JWK string
  status: 'pending' | 'approved' | 'rejected';
  encrypted_master_keys?: string; // JSON with { encryptedAesKey, iv, encryptedMasterKeys }
  expires_at?: string;
  responded_at?: string;
  approved_by_device_id?: string;
}

export interface ReplyData {
  id: string;
  name: string;
  text: string;
}

export interface DecryptedMessage {
  id: string;
  sender_id: number;
  text: string;
  created_at: string;
  isMine: boolean;
  senderName: string;
  reply?: ReplyData;
  isAuthentic: boolean;
  isError: boolean;
  deliveryStatus?: 'sending' | 'failed' | 'sent';
  retryPayload?:
    | { kind: 'text'; text: string; reply?: ReplyData | null }
    | { kind: 'voice'; blob: Blob; waveform: string; reply?: ReplyData | null; localUrl?: string };
  voiceData?: {
    fileName: string;
    waveform: number[];
    transcription: string;
    isProcessing: boolean;
    isError: boolean;
    hasTranscript: boolean;
    localUrl?: string;
  };
  inviteData?: {
    groupId: string;
    groupName: string;
    keysJSON: string;
  };
}
