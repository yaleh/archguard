import { createHash } from 'crypto';
import fs from 'fs-extra';
import path from 'path';

export const RENDER_CACHE_VERSION = '1.0';

export interface RenderOptions {
  theme: string;
  transparentBackground: boolean;
}

export class RenderHashCache {
  /**
   * Compute a deterministic cache key for the given mmd content + render options.
   * Synchronous SHA-256 of "RENDER_CACHE_VERSION|theme|transparentBg|mmdContent".
   */
  computeKey(mmdContent: string, options: RenderOptions): string {
    const input = `${RENDER_CACHE_VERSION}|${options.theme}|${String(options.transparentBackground)}|${mmdContent}`;
    return createHash('sha256').update(input, 'utf-8').digest('hex');
  }

  /**
   * Check if the sidecar hash file matches the current content+options AND the SVG exists.
   * Returns true only when both conditions hold (genuine cache hit).
   */
  async checkHit(mmdPath: string, mmdContent: string, options: RenderOptions): Promise<boolean> {
    const sidecar = RenderHashCache.sidecarPath(mmdPath);
    try {
      if (!(await fs.pathExists(sidecar))) return false;
      const storedHash = (await fs.readFile(sidecar, 'utf-8')).trim();
      if (storedHash !== this.computeKey(mmdContent, options)) return false;
      const svgPath = mmdPath.replace(/\.mmd$/, '.svg');
      return fs.pathExists(svgPath);
    } catch {
      return false;
    }
  }

  /**
   * Write the computed hash to the sidecar file next to the .mmd file.
   */
  async writeHash(mmdPath: string, mmdContent: string, options: RenderOptions): Promise<void> {
    const sidecar = RenderHashCache.sidecarPath(mmdPath);
    await fs.ensureDir(path.dirname(sidecar));
    await fs.writeFile(sidecar, this.computeKey(mmdContent, options), 'utf-8');
  }

  /**
   * Delete all *.mmd.render-hash sidecar files under the given directory recursively.
   */
  async clearHashes(dir: string): Promise<void> {
    const { glob } = await import('glob');
    const files = await glob('**/*.mmd.render-hash', { cwd: dir, absolute: true });
    await Promise.all(files.map((f) => fs.remove(f)));
  }

  /**
   * Returns the sidecar path for a given .mmd file path.
   */
  static sidecarPath(mmdPath: string): string {
    return `${mmdPath}.render-hash`;
  }
}
