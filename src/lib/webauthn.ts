/**
 * WebAuthn helpers that call navigator.credentials.create/get directly.
 *
 * The @simplewebauthn/browser library's startRegistration/startAuthentication
 * may produce incorrect options on Android Chrome (e.g., causing NFC/USB
 * prompts instead of fingerprint). Using the native API directly avoids this,
 * matching the approach of the reference project (demo-webauthn-pubkey).
 */

/** Convert a base64url string to ArrayBuffer */
function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (base64.length % 4)) % 4;
  const padded = base64 + '='.repeat(padLen);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}

/** Convert ArrayBuffer to base64url string */
export function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Convert ArrayBuffer to raw base64 string (for server compatibility) */
export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

interface RegistrationOptionsJSON {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: string; alg: number }[];
  timeout?: number;
  attestation?: string;
  excludeCredentials?: { id: string; type: string; transports?: string[] }[];
  authenticatorSelection?: {
    authenticatorAttachment?: string;
    residentKey?: string;
    requireResidentKey?: boolean;
    userVerification?: string;
  };
}

interface AuthenticationOptionsJSON {
  challenge: string;
  rpId?: string;
  allowCredentials?: { id: string; type: string; transports?: string[] }[];
  timeout?: number;
  userVerification?: string;
}

/**
 * Register a new passkey using the native navigator.credentials.create() API.
 * This matches the reference project's approach exactly.
 */
export async function nativeStartRegistration(optionsJSON: RegistrationOptionsJSON): Promise<any> {
  // Build the native options, matching the reference project's composeOptPkCreate:
  // - rp without explicit id (let browser use current origin)
  // - authenticatorSelection with userVerification and residentKey only
  // - NO authenticatorAttachment
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64urlToBuffer(optionsJSON.challenge),
    rp: { name: optionsJSON.rp.name },
    user: {
      id: base64urlToBuffer(optionsJSON.user.id),
      name: optionsJSON.user.name,
      displayName: optionsJSON.user.displayName,
    },
    pubKeyCredParams: optionsJSON.pubKeyCredParams.map(p => ({
      type: p.type as PublicKeyCredentialType,
      alg: p.alg,
    })),
    timeout: optionsJSON.timeout ?? 60000,
    attestation: (optionsJSON.attestation as AttestationConveyancePreference) ?? 'none',
  };

  // Only add authenticatorSelection if present (without authenticatorAttachment)
  if (optionsJSON.authenticatorSelection) {
    const sel = optionsJSON.authenticatorSelection;
    publicKey.authenticatorSelection = {
      userVerification: (sel.userVerification as UserVerificationRequirement) ?? 'preferred',
      residentKey: (sel.residentKey as ResidentKeyRequirement) ?? 'preferred',
    };
    // Do NOT set authenticatorAttachment — this causes NFC/USB prompts on Android
  }

  // Add excludeCredentials if present
  if (optionsJSON.excludeCredentials?.length) {
    publicKey.excludeCredentials = optionsJSON.excludeCredentials.map(cred => ({
      id: base64urlToBuffer(cred.id),
      type: cred.type as PublicKeyCredentialType,
      transports: cred.transports as AuthenticatorTransport[],
    }));
  }

  const credential = await navigator.credentials.create({ publicKey });

  if (!credential) {
    throw new Error('navigator.credentials.create() вернул null');
  }

  // Convert back to JSON format for server
  const result: any = {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64url((credential.response as AuthenticatorAttestationResponse).attestationObject),
      clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
      getAuthenticatorData: (credential.response as AuthenticatorAttestationResponse).getAuthenticatorData
        ? bufferToBase64url((credential.response as AuthenticatorAttestationResponse).getAuthenticatorData())
        : undefined,
      getPublicKey: (credential.response as AuthenticatorAttestationResponse).getPublicKey
        ? bufferToBase64((credential.response as AuthenticatorAttestationResponse).getPublicKey()!)
        : undefined,
      getPublicKeyAlgorithm: (credential.response as AuthenticatorAttestationResponse).getPublicKeyAlgorithm
        ? (credential.response as AuthenticatorAttestationResponse).getPublicKeyAlgorithm()
        : undefined,
      getTransports: (credential.response as AuthenticatorAttestationResponse).getTransports
        ? (credential.response as AuthenticatorAttestationResponse).getTransports()
        : [],
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  };

  return result;
}

/**
 * Authenticate an existing passkey using the native navigator.credentials.get() API.
 */
export async function nativeStartAuthentication(optionsJSON: AuthenticationOptionsJSON): Promise<PublicKeyCredentialJSON> {
  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64urlToBuffer(optionsJSON.challenge),
    timeout: optionsJSON.timeout ?? 60000,
  };

  // Only add rpId if present (otherwise browser uses current origin)
  if (optionsJSON.rpId) {
    publicKey.rpId = optionsJSON.rpId;
  }

  if (optionsJSON.userVerification) {
    publicKey.userVerification = optionsJSON.userVerification as UserVerificationRequirement;
  }

  // Add allowCredentials if present
  if (optionsJSON.allowCredentials?.length) {
    publicKey.allowCredentials = optionsJSON.allowCredentials.map(cred => ({
      id: base64urlToBuffer(cred.id),
      type: cred.type as PublicKeyCredentialType,
      transports: cred.transports as AuthenticatorTransport[],
    }));
  }

  const credential = await navigator.credentials.get({ publicKey });

  if (!credential) {
    throw new Error('navigator.credentials.get() вернул null');
  }

  // Convert back to JSON format for server
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64url(credential.rawId),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64url(response.userHandle)
        : undefined,
    },
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
  } as PublicKeyCredentialJSON;
}
