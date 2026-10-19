import { hashPinCore, newSalt } from "./pin-core.js";

export function isValidPin(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

export async function hashPin(pepper: string, pin: string): Promise<{ hash: string; salt: string }> {
  const salt = newSalt();
  return { hash: await hashPinCore(pepper, salt, pin), salt };
}

export async function verifyPin(pepper: string, pin: string, salt: string, hash: string): Promise<boolean> {
  return timingSafeEqual(await hashPinCore(pepper, salt, pin), hash);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
