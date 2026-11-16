// Where a rendered tear sheet is stored. The filesystem store is real and used
// now; a Vercel Blob / IPFS store implements the same interface and is wired in
// once a token is available (it needs network creds, so it's not built blind here).

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface TearSheetStore {
  /** Store bytes under `key`; returns a locator (path or URL). */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<string>;
}

/** Real filesystem store — writes under a base directory. */
export class LocalFsStore implements TearSheetStore {
  constructor(private readonly baseDir: string) {}

  async put(key: string, bytes: Uint8Array, _contentType: string): Promise<string> {
    const path = join(this.baseDir, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return path;
  }
}
