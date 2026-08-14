// Credential encryption for SSH host secrets (passwords / passphrases).
//
// Machine-bound AES-256-GCM. The key is derived from the OS hostname + a fixed app
// salt. This is NOT a strong secret against a determined local admin (they can recompute
// the key), but it ensures a copied ~/.ccc-ui/hosts.json is unreadable on a different
// machine — which is the realistic threat model for a single-user config tool. For
// higher assurance, swap machineKey() for an OS keychain (DPAPI / libsecret) later.

import crypto from 'node:crypto';
import os from 'node:os';

const APP_SALT = 'ccc-ui/hosts/v1';

/** Derive a 32-byte AES-256 key bound to this machine's hostname. */
function machineKey(): Buffer {
	const seed = `${os.hostname()}:${APP_SALT}`;
	return crypto.createHash('sha256').update(seed).digest();
}

/** Encrypt a plaintext secret into a self-describing JSON envelope (v1). */
export function encrypt(plain: string): string {
	const key = machineKey();
	const iv = crypto.randomBytes(12); // GCM standard 12-byte nonce
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: tag.toString('base64'), data: enc.toString('base64') });
}

/** Decrypt a v1 envelope. Throws on tamper (GCM auth-tag mismatch) or wrong machine. */
export function decrypt(payload: string): string {
	const obj = JSON.parse(payload) as { v: number; iv: string; tag: string; data: string };
	if (obj.v !== 1) throw new Error('unsupported ciphertext version');
	const key = machineKey();
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(obj.iv, 'base64'));
	decipher.setAuthTag(Buffer.from(obj.tag, 'base64'));
	return Buffer.concat([decipher.update(Buffer.from(obj.data, 'base64')), decipher.final()]).toString('utf8');
}

/** Encrypt only when a value is present; undefined stays undefined (no stored field). */
export function encryptOpt(plain: string | undefined | null): string | undefined {
	return plain ? encrypt(plain) : undefined;
}

/** Decrypt only when a value is present; returns undefined otherwise. */
export function decryptOpt(payload: string | undefined | null): string | undefined {
	return payload ? decrypt(payload) : undefined;
}
