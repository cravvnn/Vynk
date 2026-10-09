export const PROTOCOL_VERSION = 1;

export type AeVersion = string;

export interface MemberInfo {
  id: string;
  name: string;
  color: string;
  aeVersion: AeVersion;
  build?: string;
  joinedAt: number;
  compId?: string;
  selection?: string[];
  project?: string;
  compHash?: string;
}

export interface OpTarget {
  comp: string;
  layer?: string;
}

export type OpKind =
  | 'set'
  | 'add'
  | 'remove'
  | 'reorder'
  | 'rename'
  | 'addKey'
  | 'setKey'
  | 'removeKey'
  | 'addEffect'
  | 'removeEffect'
  | 'setEffect'
  | 'setExpr'
  | 'addMask'
  | 'removeMask'
  | 'setComp'
  | 'setShape';

export interface KeyframeEaseSpec {
  in: number[][];
  out: number[][];
}

export interface EditOp {
  opId: string;
  kind: OpKind;
  target: OpTarget;
  path?: string;
  value?: unknown;
  time?: number;
  interp?: { inType: number; outType: number };
  ease?: KeyframeEaseSpec;
  spatial?: { in: number[]; out: number[] };
  index?: number;
  minAe?: AeVersion;
}

export interface LoggedOp {
  seq: number;
  author: string;
  ts: number;
  op: EditOp;
}

// A shared "base" After Effects project for a room: whoever hosts uploads the
// exact .aep, and everyone else can pull it so identities line up.
export interface BaseInfo {
  name: string;
  size: number;
  hash: string;
  uploadedBy: string;
  uploadedAt: number;
  aeVersion?: string;
}

export type C2S =
  | { t: 'hello'; proto: number; room: string; name: string; aeVersion: AeVersion; build?: string; project?: string; token?: string }
  | { t: 'cursor'; x: number; y: number; compId?: string; active?: boolean }
  | { t: 'selection'; compId?: string; layers: string[]; hash?: string }
  | { t: 'op'; op: EditOp }
  | { t: 'lock'; target: string; mode: 'acquire' | 'release' }
  | { t: 'log'; line: string }
  | { t: 'ping'; ts: number };

export type S2C =
  | {
      t: 'welcome';
      proto: number;
      selfId: string;
      room: string;
      seq: number;
      members: MemberInfo[];
      ops: LoggedOp[];
      token?: string;
      base?: BaseInfo | null;
    }
  | { t: 'base'; base: BaseInfo | null }
  | { t: 'presence'; event: 'join' | 'leave'; member: MemberInfo }
  | { t: 'cursors'; batch: Array<{ id: string; x: number; y: number; compId?: string; ts: number; active?: boolean }> }
  | { t: 'selection'; id: string; compId?: string; layers: string[]; hash?: string }
  | { t: 'op'; seq: number; author: string; ts: number; op: EditOp }
  | { t: 'lock'; target: string; owner: string | null }
  | { t: 'log'; id: string; name: string; line: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong'; ts: number };

export function parseC2S(raw: string): C2S | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const t = (msg as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  return msg as C2S;
}

export function parseS2C(raw: string): S2C | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  const t = (msg as { t?: unknown }).t;
  if (typeof t !== 'string') return null;
  return msg as S2C;
}
