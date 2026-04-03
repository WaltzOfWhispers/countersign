import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from 'node:crypto';

import { canonicalJsonStringify } from './canonical-json.js';

export function keyFingerprint(publicKeyPem) {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16);
}

export function generateEd25519Keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  return {
    publicKeyPem,
    privateKeyPem,
    keyId: `key_${keyFingerprint(publicKeyPem)}`
  };
}

export function signPayload(payload, privateKeyPem) {
  const body = Buffer.from(canonicalJsonStringify(payload));
  return sign(null, body, createPrivateKey(privateKeyPem)).toString('base64url');
}

export function verifyPayload(payload, signatureBase64Url, publicKeyPem) {
  try {
    const body = Buffer.from(canonicalJsonStringify(payload));
    const signatureBuffer = Buffer.from(signatureBase64Url, 'base64url');
    return verify(null, body, createPublicKey(publicKeyPem), signatureBuffer);
  } catch {
    return false;
  }
}
