// Tokens, passwords and private feed addresses. Encrypted with the operating system's
// keychain (DPAPI on Windows, Keychain on macOS) and kept out of store.json.

import { safeStorage } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export class Secrets {
  /** False when the OS offers no encryption; secrets then live in memory for this run only. */
  available = false;
  private disk: Record<string, string> = {};
  private readonly memory = new Map<string, string>();

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    try {
      this.available = await safeStorage.isAsyncEncryptionAvailable();
    } catch {
      this.available = false;
    }
    if (existsSync(this.file)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
        if (typeof parsed === 'object' && parsed !== null) this.disk = parsed as Record<string, string>;
      } catch (err) {
        console.error('[secrets] could not read the secrets file; connections will need to be re-entered:', err);
      }
    }
  }

  has(name: string): boolean {
    return this.memory.has(name) || name in this.disk;
  }

  async get(name: string): Promise<string | null> {
    const mem = this.memory.get(name);
    if (mem !== undefined) return mem;
    const stored = this.disk[name];
    if (!stored || !this.available) return null;
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(stored, 'base64'));
      return result;
    } catch (err) {
      console.error(`[secrets] could not decrypt "${name}":`, err);
      return null;
    }
  }

  /** Stores a secret, or removes it when `value` is null. */
  async set(name: string, value: string | null): Promise<void> {
    this.memory.delete(name);
    if (value === null) {
      if (name in this.disk) {
        delete this.disk[name];
        await this.save();
      }
      return;
    }
    if (!this.available) {
      this.memory.set(name, value);
      return;
    }
    const encrypted = await safeStorage.encryptStringAsync(value);
    this.disk[name] = encrypted.toString('base64');
    await this.save();
  }

  private async save(): Promise<void> {
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.disk), 'utf8');
    await rename(tmp, this.file);
  }
}
