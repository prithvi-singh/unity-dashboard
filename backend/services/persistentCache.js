'use strict';

/**
 * persistentCache — file-based persistent cache with a hot in-memory layer.
 *
 * Data is written to JSON files on disk so it survives process restarts
 * (within the same container). On startup the cache is re-read from disk
 * and promoted to memory.
 *
 * Config:
 *   CACHE_DIR — directory for cache files (default /tmp/unity-cache)
 *   CACHE_STORAGE — 'file' (default) or 'blob' (future)
 */

const fs = require('fs');
const path = require('path');

class PersistentCache {
  constructor() {
    this.memoryCache = new Map();
    this.cacheDir = process.env.CACHE_DIR || '/tmp/unity-cache';
    this._ensureDir();
    this._loadFromDisk();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _ensureDir() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch (err) {
      console.warn(`[cache] Could not create cache dir ${this.cacheDir}:`, err.message);
    }
  }

  _loadFromDisk() {
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const filePath = path.join(this.cacheDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const key = file.replace('.json', '');
          this.memoryCache.set(key, { data, loadedAt: Date.now() });
        } catch (err) {
          console.warn(`[cache] Skipping corrupt cache file ${file}:`, err.message);
        }
      }
      console.log(`[cache] Loaded ${this.memoryCache.size} entries from disk`);
    } catch (err) {
      console.warn('[cache] Could not read cache dir:', err.message);
    }
  }

  _filePath(key) {
    return path.join(this.cacheDir, `${key}.json`);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * getCacheKey(name, identifier)
   * Builds a stable cache key. identifier can be a date string (YYYY-MM-DD)
   * or a window label like '7d', '30d', etc.
   */
  getCacheKey(name, identifier) {
    return `${name}-${identifier}`;
  }

  /**
   * get(name, identifier)
   * Returns cached data or null. Checks hot memory layer first, then disk.
   */
  async get(name, identifier) {
    const key = this.getCacheKey(name, identifier);

    // Hot memory cache
    if (this.memoryCache.has(key)) {
      return this.memoryCache.get(key).data;
    }

    // Disk cache
    const filePath = this._filePath(key);
    try {
      if (!fs.existsSync(filePath)) return null;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      this.memoryCache.set(key, { data, loadedAt: Date.now() });
      return data;
    } catch {
      return null;
    }
  }

  /**
   * set(name, identifier, data)
   * Writes to memory and disk.
   */
  async set(name, identifier, data) {
    const key = this.getCacheKey(name, identifier);
    const entry = { data, savedAt: Date.now() };
    this.memoryCache.set(key, entry);

    const filePath = this._filePath(key);
    try {
      this._ensureDir();
      fs.writeFileSync(filePath, JSON.stringify(data));
      console.log(`[cache] Persisted ${key} (${JSON.stringify(data).length} bytes)`);
    } catch (err) {
      console.error(`[cache] Failed to write ${key}:`, err.message);
    }
  }

  /**
   * invalidate(name, identifier)
   * Removes from memory and disk.
   */
  async invalidate(name, identifier) {
    const key = this.getCacheKey(name, identifier);
    this.memoryCache.delete(key);
    const filePath = this._filePath(key);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      console.log(`[cache] Invalidated ${key}`);
    } catch (err) {
      console.warn(`[cache] Could not delete ${key}:`, err.message);
    }
  }

  /**
   * clear()
   * Removes all entries from memory and disk.
   */
  async clear() {
    this.memoryCache.clear();
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          fs.unlinkSync(path.join(this.cacheDir, file));
        }
      }
      console.log('[cache] All cache entries cleared');
    } catch (err) {
      console.warn('[cache] Could not clear cache dir:', err.message);
    }
  }

  /**
   * cleanup(keepDays)
   * Deletes cache files older than keepDays.
   */
  async cleanup(keepDays = 7) {
    try {
      const files = fs.readdirSync(this.cacheDir);
      const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
      let removed = 0;
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.cacheDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(filePath);
            // Also remove from memory
            const key = file.replace('.json', '');
            this.memoryCache.delete(key);
            removed++;
          }
        } catch { /* skip corrupt files */ }
      }
      if (removed > 0) {
        console.log(`[cache] Cleaned up ${removed} old cache files`);
      }
    } catch (err) {
      console.warn('[cache] Cleanup error:', err.message);
    }
  }

  /**
   * stats()
   * Returns cache state for health/admin endpoints.
   */
  stats() {
    const entries = [];
    try {
      const files = fs.readdirSync(this.cacheDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const filePath = path.join(this.cacheDir, file);
          const stat = fs.statSync(filePath);
          const key = file.replace('.json', '');
          const [name, ...rest] = key.split('-');
          entries.push({
            key,
            name,
            window: rest.join('-'),
            sizeBytes: stat.size,
            savedAt: new Date(stat.mtimeMs).toISOString(),
          });
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    const totalSizeBytes = entries.reduce((s, e) => s + e.sizeBytes, 0);
    return {
      entries,
      totalSizeBytes,
      memoryEntries: this.memoryCache.size,
    };
  }
}

// Singleton
const persistentCache = new PersistentCache();
module.exports = persistentCache;
