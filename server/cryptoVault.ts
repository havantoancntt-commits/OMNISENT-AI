import crypto from 'node:crypto';

// Ephemeral fallback only when VAULT_ENCRYPTION_KEY env var is absent in preview
const RUNTIME_KEY_MATERIAL =
  process.env.VAULT_ENCRYPTION_KEY && process.env.VAULT_ENCRYPTION_KEY.length >= 16
    ? process.env.VAULT_ENCRYPTION_KEY
    : crypto.randomBytes(32).toString('hex');

const DERIVED_KEY = crypto.scryptSync(RUNTIME_KEY_MATERIAL, 'omnisent-vault-salt-v1', 32);

export interface DecryptedSecretPayload {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

export function encryptSecretPayload(payload: DecryptedSecretPayload): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DERIVED_KEY, iv);
  const plaintext = JSON.stringify({
    apiKey: payload.apiKey,
    apiSecret: payload.apiSecret,
    ...(payload.passphrase ? { passphrase: payload.passphrase } : {}),
  });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('hex'),
    tag: authTag.toString('hex'),
    data: encrypted.toString('hex'),
  });
}

export function decryptSecretPayload(encryptedJson: string): DecryptedSecretPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encryptedJson);
  } catch {
    throw new Error('Vault payload không phải JSON hợp lệ.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Vault payload có cấu trúc không hợp lệ.');
  }

  const envelope = parsed as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
  if (
    envelope.v !== 1 ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.tag !== 'string' ||
    typeof envelope.data !== 'string' ||
    !/^[0-9a-f]+$/i.test(envelope.iv) ||
    !/^[0-9a-f]+$/i.test(envelope.tag) ||
    !/^[0-9a-f]*$/i.test(envelope.data)
  ) {
    throw new Error('Vault envelope thiếu trường mã hóa hoặc sai định dạng.');
  }

  const iv = Buffer.from(envelope.iv, 'hex');
  const tag = Buffer.from(envelope.tag, 'hex');
  const data = Buffer.from(envelope.data, 'hex');

  if (iv.length !== 12 || tag.length !== 16 || data.length === 0) {
    throw new Error('Vault envelope có kích thước IV/AuthTag không hợp lệ.');
  }

  const decipher = crypto.createDecipheriv('aes-256-gcm', DERIVED_KEY, iv);
  decipher.setAuthTag(tag);

  let plaintext: string;
  try {
    plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Giải mã Vault thất bại hoặc dữ liệu đã bị thay đổi.');
  }

  const payload = JSON.parse(plaintext) as Partial<DecryptedSecretPayload>;
  if (typeof payload.apiKey !== 'string' || typeof payload.apiSecret !== 'string') {
    throw new Error('Dữ liệu giải mã thiếu apiKey hoặc apiSecret.');
  }

  return {
    apiKey: payload.apiKey,
    apiSecret: payload.apiSecret,
    passphrase: typeof payload.passphrase === 'string' && payload.passphrase.length > 0
      ? payload.passphrase
      : undefined,
  };
}

export function maskApiKey(apiKey: string): string {
  const clean = apiKey.trim();
  if (clean.length <= 8) return '••••••••';
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}
