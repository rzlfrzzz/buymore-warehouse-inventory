import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export async function hashPassword(password: string) {
 const salt = randomBytes(16).toString('hex');
 const hash = await scrypt(password,salt,64) as Buffer;
 return `${salt}:${hash.toString('hex')}`;
}
export async function verifyPassword(password: string, stored: string) {
 const [salt, hash] = stored.split(':');
 const actual = await scrypt(password,salt,64) as Buffer;
 const expected = Buffer.from(hash,'hex');
 return actual.length === expected.length && timingSafeEqual(actual,expected);
}
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
