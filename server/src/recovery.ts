import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { LoggedOp } from '@vynk/protocol';

export const MAX_PENDING_OPS = 500;

export function pendingIds(input: unknown): string[] | null {
  if (!Array.isArray(input) || input.length > MAX_PENDING_OPS) return null;
  if (input.some((id: unknown) => typeof id !== 'string' || id.length === 0 || id.length > 128)) return null;
  return [...new Set(input as string[])];
}

interface RecoveryRoom {
  seq: number;
  log: LoggedOp[];
}

export interface Receipts {
  through: number;
  accepted: Map<string, LoggedOp>;
}

export async function findReceipts(room: RecoveryRoom, ids: string[], file: string): Promise<Receipts> {
  const through = room.seq;
  const wanted = new Set(ids);
  const accepted = new Map<string, LoggedOp>();
  const recent = room.log.slice();
  for (const entry of recent) {
    if (Number.isSafeInteger(entry.seq) && entry.seq > 0 && entry.seq <= through && wanted.has(entry.op?.opId)) accepted.set(entry.op.opId, entry);
  }
  if (accepted.size === wanted.size) return { through, accepted };
  let next = 1;
  const visit = (entry: LoggedOp): void => {
    if (entry.seq !== next || typeof entry.op?.opId !== 'string') throw new Error('incomplete recovery log');
    if (wanted.has(entry.op.opId)) accepted.set(entry.op.opId, entry);
    next++;
  };
  if (through > 0 && ids.length > 0) {
    if (recent.length === through && recent[0]?.seq === 1) {
      for (const entry of recent) visit(entry);
    } else {
      const input = createReadStream(file);
      const lines = createInterface({ input, crlfDelay: Infinity });
      try {
        for await (const line of lines) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line) as LoggedOp;
          visit(entry);
          if (entry.seq === through) break;
        }
      } finally {
        lines.close();
        input.destroy();
      }
    }
    if (next !== through + 1) throw new Error('incomplete recovery log');
  }
  return { through, accepted };
}

export function mergeReceipts(room: RecoveryRoom, ids: Set<string>, receipts: Receipts): void {
  let next = receipts.through + 1;
  for (const entry of room.log) {
    if (entry.seq < next) continue;
    if (entry.seq !== next) throw new Error('recovery log advanced too far');
    if (ids.has(entry.op.opId)) receipts.accepted.set(entry.op.opId, entry);
    next++;
  }
  if (next !== room.seq + 1) throw new Error('recovery log advanced too far');
}
