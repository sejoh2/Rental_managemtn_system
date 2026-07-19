const crypto = require('crypto');

function getEncryptionKey() {
  const rawKey = process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY;

  if (!rawKey) {
    throw new Error('PAYMENT_CREDENTIAL_ENCRYPTION_KEY is required');
  }

  const key = /^[a-f0-9]{64}$/i.test(rawKey)
    ? Buffer.from(rawKey, 'hex')
    : Buffer.from(rawKey, 'base64');

  if (key.length !== 32) {
    throw new Error(
      'PAYMENT_CREDENTIAL_ENCRYPTION_KEY must be exactly 32 bytes (64 hexadecimal characters)'
    );
  }

  return key;
}

function encryptJson(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function decryptJson(encryptedValue) {
  const [ivValue, authTagValue, cipherText] = String(encryptedValue).split(':');

  if (!ivValue || !authTagValue || !cipherText) {
    throw new Error('Stored payment credentials are invalid');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64')
  );

  decipher.setAuthTag(Buffer.from(authTagValue, 'base64'));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]);

  return JSON.parse(decrypted.toString('utf8'));
}

module.exports = {
  encryptJson,
  decryptJson,
};