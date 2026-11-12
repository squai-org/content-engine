import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { Store } from './db.ts';

export type Sample = { at: number; cpu: number; memory: number };
type Egress = { month: string; bytes: number; last: number };
type Storage = { total: number; used: number; media: number; workspace: number; database: number };

export const FREE_TIER = { ocpu: 4, memoryGb: 24, storageGb: 200, egressTb: 10 };

const SAMPLE_MS = 30000;
const HISTORY = 2880;
const BUCKETS = 96;
const STORAGE_TTL_MS = 5 * 60 * 1000;
const MIN_FREE_BYTES = 2 * 1024 ** 3;
const WARN_RATIO = 0.8;
const EGRESS_KEY = 'egress';
const GB = 1024 ** 3;

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.irq + cpu.times.idle;
  }
  return { idle, total };
}

function memoryUsed(): number {
  try {
    const available = /MemAvailable:\s+(\d+) kB/.exec(readFileSync('/proc/meminfo', 'utf8'));
    if (available) return os.totalmem() - Number(available[1]) * 1024;
  } catch {}
  return os.totalmem() - os.freemem();
}

export function transmittedBytes(table: string): number {
  return table
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/[:\s]+/))
    .filter((columns) => columns.length > 9 && columns[0] !== 'lo')
    .reduce((sum, columns) => sum + Number(columns[9]), 0);
}

export function addEgress(previous: Egress | null, month: string, counter: number): Egress {
  if (!previous) return { month, bytes: 0, last: counter };
  const delta = counter >= previous.last ? counter - previous.last : counter;
  return { month, bytes: previous.month === month ? previous.bytes + delta : delta, last: counter };
}

function sizeOf(path: string): number {
  if (!existsSync(path)) return 0;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

export function createMonitor(config: Config, store: Store) {
  const samples: Sample[] = [];
  let before = cpuTimes();
  let storage: (Storage & { at: number }) | null = null;

  function readStorage(): Storage {
    if (storage && Date.now() - storage.at < STORAGE_TTL_MS) return storage;
    const fs = statfsSync(config.dataDir);
    const total = fs.blocks * fs.bsize;
    storage = {
      at: Date.now(),
      total,
      used: total - fs.bavail * fs.bsize,
      media: sizeOf(join(config.dataDir, 'media')),
      workspace: sizeOf(join(config.dataDir, 'workspace')),
      database: ['content.db', 'content.db-wal'].reduce(
        (sum, name) => sum + sizeOf(join(config.dataDir, name)),
        0,
      ),
    };
    return storage;
  }

  function sample(): void {
    const now = cpuTimes();
    const total = now.total - before.total;
    const cpu = total > 0 ? 1 - (now.idle - before.idle) / total : 0;
    before = now;
    samples.push({ at: Date.now(), cpu, memory: memoryUsed() });
    if (samples.length > HISTORY) samples.shift();
    try {
      const counter = transmittedBytes(readFileSync('/proc/net/dev', 'utf8'));
      const month = new Date().toISOString().slice(0, 7);
      store.setSetting(EGRESS_KEY, addEgress(store.getSetting<Egress | null>(EGRESS_KEY, null), month, counter));
    } catch {}
  }

  function history(): Sample[] {
    const size = Math.max(1, Math.ceil(samples.length / BUCKETS));
    const buckets: Sample[] = [];
    for (let start = 0; start < samples.length; start += size) {
      const group = samples.slice(start, start + size);
      buckets.push({
        at: group[group.length - 1].at,
        cpu: group.reduce((sum, entry) => sum + entry.cpu, 0) / group.length,
        memory: group.reduce((sum, entry) => sum + entry.memory, 0) / group.length,
      });
    }
    return buckets;
  }

  function pausedReason(): string {
    const disk = readStorage();
    return disk.total - disk.used < MIN_FREE_BYTES
      ? 'Queda menos de 2 GB libres en disco. Los agentes están en pausa hasta liberar espacio.'
      : '';
  }

  sample();
  const timer = setInterval(sample, SAMPLE_MS);
  timer.unref();

  return {
    pausedReason,
    stop: () => clearInterval(timer),

    snapshot() {
      const disk = readStorage();
      const egress = store.getSetting<Egress | null>(EGRESS_KEY, null);
      const month = new Date().toISOString().slice(0, 7);
      const egressBytes = egress?.month === month ? egress.bytes : 0;
      const latest = samples[samples.length - 1];
      const warnings: string[] = [];
      const paused = pausedReason();
      if (paused) warnings.push(paused);
      else if (disk.used / disk.total > WARN_RATIO) warnings.push('El disco supera el 80 % de uso.');
      if (disk.total > FREE_TIER.storageGb * GB) {
        warnings.push(`El disco de la máquina supera los ${FREE_TIER.storageGb} GB gratuitos de Oracle.`);
      }
      if (os.cpus().length > FREE_TIER.ocpu || os.totalmem() > (FREE_TIER.memoryGb + 1) * GB) {
        warnings.push('La máquina es más grande que la capa gratuita de Oracle (4 OCPU, 24 GB).');
      }
      if (egressBytes > FREE_TIER.egressTb * 1024 * GB * WARN_RATIO) {
        warnings.push('El tráfico de salida del mes supera el 80 % de los 10 TB gratuitos.');
      }
      return {
        limits: FREE_TIER,
        cpu: { used: latest?.cpu ?? 0, cores: os.cpus().length, load: os.loadavg()[0] },
        memory: { used: latest?.memory ?? 0, total: os.totalmem() },
        disk,
        egress: { month, bytes: egressBytes },
        uptime: os.uptime(),
        jobsToday: store.countJobsSince(new Date(Date.now() - 86400000).toISOString()),
        warnings,
        history: history(),
      };
    },
  };
}

export type Monitor = ReturnType<typeof createMonitor>;
