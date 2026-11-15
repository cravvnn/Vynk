import { createServer } from 'node:http';
import { appendFile, mkdir, readFile, readdir, stat, rm, writeFile, rename, unlink } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  parseC2S,
  type BaseInfo,
  type EditOp,
  type LoggedOp,
  type MemberInfo,
  type S2C,
} from '@vynk/protocol';
import { findReceipts, mergeReceipts, pendingIds } from './recovery.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data', 'rooms');
const CURSOR_FLUSH_MS = 33;
const HELLO_TIMEOUT_MS = 5000;
const MAX_PEERS_PER_ROOM = 16;
const MAX_LOG_IN_MEMORY = 5000;
const MAX_OPS_IN_WELCOME = Math.max(1, Number(process.env.MAX_OPS_IN_WELCOME ?? 3000));
const MSG_LIMIT_PER_SEC = 400;
const HEARTBEAT_MS = 30000;
const MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;
const LOG_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_DIR = process.env.BASE_DIR ?? path.join(__dirname, '..', 'data', 'bases');
const MAX_BASE_BYTES = Number(process.env.MAX_BASE_BYTES ?? 200 * 1024 * 1024);
const MAX_CONCURRENT_UPLOADS = Number(process.env.MAX_CONCURRENT_UPLOADS ?? 4);
let baseUploadsInFlight = 0;
const PALETTE = ['#ff5c5c', '#ffb020', '#ffe14d', '#5cd97a', '#4dc9ff', '#9a7aff', '#e05cff', '#ff7ad9'];

interface Peer {
  id: string;
  socket: WebSocket;
  info: MemberInfo | null;
  room: Room | null;
  cursor: { x: number; y: number; compId?: string; active?: boolean } | null;
  cursorDirty: boolean;
  msgCount: number;
  windowStart: number;
  alive: boolean;
  joining: boolean;
  closed: boolean;
  pendingIds: Set<string>;
  receipts: Map<string, LoggedOp>;
}

interface Room {
  code: string;
  // Secret issued to members in `welcome`; required to upload/download the base
  // .aep over HTTP (keeps the base URL from being guessable from the room code).
  token: string;
  base: BaseInfo | null;
  // The snapshot's captured prefix; edits during upload still need replay.
  baseSeq: number;
  lastBasePut: number;
  peers: Map<string, Peer>;
  locks: Map<string, string>;
  seq: number;
  log: LoggedOp[];
  flushTimer: NodeJS.Timeout | null;
  writeChain: Promise<void>;
  writeFailed: boolean;
  reservations: number;
  baseUploading: boolean;
}

const rooms = new Map<string, Room>();
const roomsByToken = new Map<string, Room>();

function nowMs(): number {
  return Date.now();
}

function sanitizeName(input: unknown): string {
  const raw = typeof input === 'string' ? input : 'anon';
  const clean = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
  return clean.length > 0 ? clean : 'anon';
}

function sanitizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const code = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return code.length >= 4 ? code : null;
}

function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function send(socket: WebSocket, msg: S2C): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

function broadcast(room: Room, msg: S2C, exceptId?: string): void {
  for (const peer of room.peers.values()) {
    if (peer.id === exceptId) continue;
    send(peer.socket, msg);
  }
}

function publicInfo(peer: Peer): MemberInfo {
  const info = peer.info!;
  const out: MemberInfo = {
    id: info.id,
    name: info.name,
    color: info.color,
    aeVersion: info.aeVersion,
    joinedAt: info.joinedAt,
  };
  if (info.build !== undefined) out.build = info.build;
  if (info.compId !== undefined) out.compId = info.compId;
  if (info.selection !== undefined) out.selection = info.selection;
  if (info.project !== undefined) out.project = info.project;
  if (info.compHash !== undefined) out.compHash = info.compHash;
  return out;
}

function parseLog(text: string): LoggedOp[] {
  if (text && !text.endsWith('\n')) throw new Error('incomplete room log tail');
  const ops: LoggedOp[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line) as LoggedOp;
    if (!entry || !Number.isSafeInteger(entry.seq) || entry.seq < 1 || !entry.op || typeof entry.op.opId !== 'string' || !entry.op.opId ||
        (ops.length > 0 && entry.seq !== ops[ops.length - 1]!.seq + 1)) throw new Error('invalid room log sequence');
    ops.push(entry);
  }
  return ops;
}

async function loadLog(code: string): Promise<LoggedOp[]> {
  const file = path.join(DATA_DIR, `${code}.jsonl`);
  try {
    const { stat, open } = await import('node:fs/promises');
    const st = await stat(file);
    if (st.size > MAX_LOG_FILE_BYTES) {
      const fh = await open(file, 'r');
      try {
        const tailSize = 10 * 1024 * 1024;
        const buf = Buffer.alloc(tailSize);
        const { bytesRead } = await fh.read(buf, 0, tailSize, st.size - tailSize);
        const text = buf.toString('utf8', 0, bytesRead);
        const ops = parseLog(text.slice(text.indexOf('\n') + 1));
        if (ops.length === 0) throw new Error('empty room log tail');
        return ops;
      } finally {
        await fh.close();
      }
    }
    return parseLog(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function loadToken(code: string): Promise<string | null> {
  try {
    const t = (await readFile(path.join(BASE_DIR, `${code}.token`), 'utf8')).trim();
    if (t.length >= 8 && t.length <= 64) return t;
  } catch {}
  return null;
}

async function saveToken(code: string, token: string): Promise<void> {
  const temp = path.join(BASE_DIR, `${code}.token.tmp-${randomUUID()}`);
  try {
    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(temp, token);
    await rename(temp, path.join(BASE_DIR, `${code}.token`));
  } finally {
    await unlink(temp).catch(() => {});
  }
}

async function loadBaseMeta(code: string): Promise<BaseInfo | null> {
  try {
    const text = await readFile(path.join(BASE_DIR, `${code}.json`), 'utf8');
    const meta = JSON.parse(text) as BaseInfo;
    if (meta && typeof meta.name === 'string' && typeof meta.hash === 'string') return meta;
  } catch {}
  return null;
}

async function loadBaseSeq(code: string): Promise<number> {
  try {
    const n = Number((await readFile(path.join(BASE_DIR, `${code}.seq`), 'utf8')).trim());
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function saveBaseSeq(code: string, seq: number): Promise<void> {
  try {
    await mkdir(BASE_DIR, { recursive: true });
    await writeFile(path.join(BASE_DIR, `${code}.seq`), String(seq));
  } catch {}
}

// Dedupes concurrent creations for the same code: without this, N peers joining
// at the same instant each miss `rooms.get` during the await and create N Room
// objects with the same code (different tokens), so they never see each other.
const pendingRooms = new Map<string, Promise<Room>>();
const sweepingRooms = new Map<string, Promise<void>>();

async function getRoom(code: string): Promise<Room> {
  const sweeping = sweepingRooms.get(code);
  if (sweeping) { await sweeping; return getRoom(code); }
  const existing = rooms.get(code);
  if (existing) { existing.reservations++; return existing; }
  const pending = pendingRooms.get(code);
  if (pending) {
    const room = await pending;
    room.reservations++;
    return room;
  }
  const promise = (async () => {
    try {
      const log = await loadLog(code);
      const base = await loadBaseMeta(code);
      const baseSeq = base ? (typeof base.seq === 'number' && Number.isSafeInteger(base.seq) && base.seq >= 0 ? base.seq : await loadBaseSeq(code)) : 0;
      const persisted = await loadToken(code);
      const token = persisted ?? randomUUID().replace(/-/g, '').slice(0, 24);
      if (!persisted) await saveToken(code, token);
      const room: Room = {
        code,
        token,
        base,
        baseSeq,
        lastBasePut: 0,
        peers: new Map(),
        locks: new Map(),
        seq: Math.max(baseSeq, log.length > 0 ? log[log.length - 1]!.seq : 0),
        log: log.slice(-MAX_LOG_IN_MEMORY),
        flushTimer: null,
        writeChain: Promise.resolve(),
        writeFailed: false,
        reservations: 0,
        baseUploading: false,
      };
      room.flushTimer = setInterval(() => flushCursors(room), CURSOR_FLUSH_MS);
      rooms.set(code, room);
      roomsByToken.set(room.token, room);
      return room;
    } finally {
      pendingRooms.delete(code);
    }
  })();
  pendingRooms.set(code, promise);
  const room = await promise;
  room.reservations++;
  return room;
}

function flushCursors(room: Room): void {
  const batch: Array<{ id: string; x: number; y: number; compId?: string; ts: number; active?: boolean }> = [];
  for (const peer of room.peers.values()) {
    if (!peer.cursorDirty || !peer.cursor) continue;
    peer.cursorDirty = false;
    const entry: { id: string; x: number; y: number; compId?: string; ts: number; active?: boolean } = {
      id: peer.id,
      x: peer.cursor.x,
      y: peer.cursor.y,
      ts: nowMs(),
    };
    if (peer.cursor.compId !== undefined) entry.compId = peer.cursor.compId;
    if (peer.cursor.active === false) entry.active = false;
    batch.push(entry);
  }
  if (batch.length === 0) return;
  for (const peer of room.peers.values()) {
    const others = batch.filter((b) => b.id !== peer.id);
    if (others.length > 0) send(peer.socket, { t: 'cursors', batch: others });
  }
}

function rateLimited(peer: Peer): boolean {
  const now = nowMs();
  if (now - peer.windowStart > 1000) {
    peer.windowStart = now;
    peer.msgCount = 0;
  }
  peer.msgCount++;
  return peer.msgCount > MSG_LIMIT_PER_SEC;
}

async function handleHello(peer: Peer, msg: Extract<NonNullable<ReturnType<typeof parseC2S>>, { t: 'hello' }>): Promise<void> {
  if (peer.info || peer.joining) {
    send(peer.socket, { t: 'error', code: 'already_joined', message: 'hello already received' });
    return;
  }
  if (msg.proto !== PROTOCOL_VERSION) {
    send(peer.socket, { t: 'error', code: 'proto_mismatch', message: `server speaks protocol ${PROTOCOL_VERSION}` });
    peer.socket.close(1002, 'protocol mismatch');
    return;
  }
  const code = sanitizeCode(msg.room);
  if (!code) {
    send(peer.socket, { t: 'error', code: 'bad_room', message: 'room code must be 4-8 letters or digits' });
    peer.socket.close(1008, 'bad room');
    return;
  }
  const requested = msg.pending === undefined ? [] : pendingIds(msg.pending);
  if (!requested) {
    send(peer.socket, { t: 'error', code: 'bad_pending', message: 'invalid pending edit list' });
    peer.socket.close(1008, 'bad pending list');
    return;
  }
  peer.joining = true;
  let heldRoom: Room | null = null;
  try {
    const room = await getRoom(code);
    heldRoom = room;
    await room.writeChain;
    if (peer.closed) return;
    if (room.writeFailed) throw new Error('room log write failed');
    const after = msg.after === undefined ? room.baseSeq : msg.after;
    if (!Number.isSafeInteger(after) || after < 0 || after > room.seq || (msg.after !== undefined && msg.token !== room.token)) throw new Error('invalid replay anchor');
    const receipts = await findReceipts(room, requested, path.join(DATA_DIR, `${code}.jsonl`));
    if (peer.closed) return;
    peer.pendingIds = new Set(requested);
    mergeReceipts(room, peer.pendingIds, receipts);
    peer.receipts = receipts.accepted;
    if (room.peers.size >= MAX_PEERS_PER_ROOM) {
      send(peer.socket, { t: 'error', code: 'room_full', message: 'room is full' });
      peer.socket.close(1013, 'room full');
      return;
    }
    const info: MemberInfo = {
      id: peer.id,
      name: sanitizeName(msg.name),
      color: colorFor(peer.id),
      aeVersion: typeof msg.aeVersion === 'string' ? msg.aeVersion.slice(0, 16) : 'unknown',
      joinedAt: nowMs(),
    };
    if (typeof msg.build === 'string' && msg.build.length > 0) info.build = msg.build.slice(0, 16);
    if (typeof msg.project === 'string' && msg.project.length > 0) {
      info.project = msg.project.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
    }
    peer.info = info;
    peer.room = room;
    room.peers.set(peer.id, peer);
    const members = [...room.peers.values()].filter((p) => p.id !== peer.id).map(publicInfo);
    // A late joiner needs everything after the base. If the log cannot supply it
    // (in-memory cap, file tail, or MAX_OPS_IN_WELCOME), say so instead of handing
    // back a silently incomplete history.
    const afterBase = room.log.filter((o) => o.seq > after);
    const replayed = afterBase.slice(-MAX_OPS_IN_WELCOME);
    const truncated =
      room.seq > after && (replayed.length === 0 || replayed[0]!.seq > after + 1);
    const welcome: S2C = {
      t: 'welcome',
      proto: PROTOCOL_VERSION,
      selfId: peer.id,
      room: room.code,
      seq: room.seq,
      members,
      ops: replayed,
      token: room.token,
      base: room.base,
      baseSeq: room.baseSeq,
      checkpoint: true,
    };
    if (msg.pending !== undefined) welcome.accepted = [...peer.receipts.keys()];
    if (msg.after !== undefined) welcome.after = after;
    if (truncated) {
      welcome.truncated = true;
      welcome.fromSeq = replayed.length > 0 ? replayed[0]!.seq : room.seq + 1;
    }
    send(peer.socket, welcome);
    broadcast(room, { t: 'presence', event: 'join', member: publicInfo(peer) }, peer.id);
  } catch {
    send(peer.socket, { t: 'error', code: 'recovery_unavailable', message: 'room state could not confirm recovery; retry later' });
    peer.socket.close(1013, 'recovery unavailable');
  } finally {
    peer.joining = false;
    if (heldRoom) {
      heldRoom.reservations--;
      releaseRoom(heldRoom);
    }
  }
}

function handleOp(peer: Peer, op: EditOp): void {
  const room = peer.room!;
  if (!op || typeof op !== 'object' || typeof op.opId !== 'string' || op.opId.length === 0 || op.opId.length > 128 || typeof op.kind !== 'string') {
    send(peer.socket, { t: 'error', code: 'bad_op', message: 'malformed op' });
    return;
  }
  if (!op.target || typeof op.target !== 'object' || typeof op.target.comp !== 'string') {
    send(peer.socket, { t: 'error', code: 'bad_op', message: 'op missing target.comp' });
    return;
  }
  // A repair request is a question between two live peers, not an edit: relay
  // it, but keep it out of the log so it is never replayed to a late joiner.
  if (op.kind === 'need' || op.kind === 'sum') {
    broadcast(room, { t: 'op', seq: room.seq, author: peer.id, ts: nowMs(), op });
    return;
  }
  room.writeChain = room.writeChain.then(async () => {
    if (room.writeFailed) return;
    const previous = peer.receipts.get(op.opId) ?? room.log.find((entry) => entry.op.opId === op.opId);
    if (previous) {
      send(peer.socket, { t: 'op', seq: previous.seq, author: peer.id, ts: previous.ts, op: previous.op });
      return;
    }
    const logged: LoggedOp = { seq: room.seq + 1, author: peer.id, ts: nowMs(), op };
    await appendFile(path.join(DATA_DIR, `${room.code}.jsonl`), JSON.stringify(logged) + '\n');
    room.seq = logged.seq;
    room.log.push(logged);
    if (room.log.length > MAX_LOG_IN_MEMORY) room.log.splice(0, room.log.length - MAX_LOG_IN_MEMORY);
    for (const member of room.peers.values()) {
      if (member.pendingIds.has(op.opId)) member.receipts.set(op.opId, logged);
    }
    broadcast(room, { t: 'op', seq: logged.seq, author: logged.author, ts: logged.ts, op: logged.op });
  }).catch(() => {
    room.writeFailed = true;
    for (const member of room.peers.values()) {
      send(member.socket, { t: 'error', code: 'log_write_failed', message: 'room log could not save edits; reconnect to recover' });
      member.socket.close(1013, 'log write failed');
    }
  });
}

function handleMessage(peer: Peer, raw: string): void {
  if (peer.closed) return;
  const msg = parseC2S(raw);
  if (!msg) {
    send(peer.socket, { t: 'error', code: 'bad_json', message: 'could not parse message' });
    return;
  }
  if (msg.t === 'hello') {
    void handleHello(peer, msg);
    return;
  }
  if (!peer.info || !peer.room) {
    send(peer.socket, { t: 'error', code: 'not_joined', message: 'send hello first' });
    return;
  }
  const room = peer.room;
  switch (msg.t) {
    case 'cursor': {
      const x = Number(msg.x);
      const y = Number(msg.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      peer.cursorDirty = true;
      const cursor: { x: number; y: number; compId?: string; active?: boolean } = {
        x: Math.min(1, Math.max(0, x)),
        y: Math.min(1, Math.max(0, y)),
      };
      if (typeof msg.compId === 'string') cursor.compId = msg.compId;
      if (msg.active === false) cursor.active = false;
      peer.cursor = cursor;
      if (cursor.compId !== peer.info.compId) peer.info.compId = cursor.compId;
      return;
    }
    case 'selection': {
      const layers = Array.isArray(msg.layers) ? msg.layers.filter((l) => typeof l === 'string').slice(0, 500) : [];
      peer.info.selection = layers;
      if (typeof msg.compId === 'string') peer.info.compId = msg.compId;
      if (typeof msg.hash === 'string' && msg.hash.length > 0) peer.info.compHash = msg.hash.slice(0, 32);
      broadcast(room, { t: 'selection', id: peer.id, compId: msg.compId, layers, hash: peer.info.compHash }, peer.id);
      return;
    }
    case 'op': {
      handleOp(peer, msg.op);
      return;
    }
    case 'lock': {
      const target = String(msg.target).slice(0, 256);
      if (msg.mode === 'acquire') {
        const owner = room.locks.get(target);
        if (owner && owner !== peer.id) {
          send(peer.socket, { t: 'error', code: 'locked', message: `locked by ${owner}` });
          return;
        }
        room.locks.set(target, peer.id);
        broadcast(room, { t: 'lock', target, owner: peer.id });
      } else {
        if (room.locks.get(target) === peer.id) room.locks.delete(target);
        broadcast(room, { t: 'lock', target, owner: room.locks.get(target) ?? null });
      }
      return;
    }
    case 'log': {
      const line = String(msg.line ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .slice(0, 300);
      if (!line) return;
      broadcast(room, { t: 'log', id: peer.id, name: peer.info.name, line }, peer.id);
      return;
    }
    case 'ping': {
      send(peer.socket, { t: 'pong', ts: msg.ts });
      return;
    }
    default:
      send(peer.socket, { t: 'error', code: 'unknown_type', message: 'unknown message type' });
  }
}

function closePeer(peer: Peer): void {
  if (peer.closed) return;
  peer.closed = true;
  const room = peer.room;
  if (!room) return;
  room.peers.delete(peer.id);
  for (const [target, owner] of room.locks) {
    if (owner === peer.id) {
      room.locks.delete(target);
      broadcast(room, { t: 'lock', target, owner: null });
    }
  }
  if (peer.info) broadcast(room, { t: 'presence', event: 'leave', member: publicInfo(peer) }, peer.id);
  releaseRoom(room);
}

function releaseRoom(room: Room): void {
  if (room.peers.size > 0 || room.reservations > 0) return;
  const writes = room.writeChain;
  void writes.then(() => {
    if (rooms.get(room.code) !== room || room.peers.size > 0 || room.reservations > 0 || room.writeChain !== writes) return;
    if (room.flushTimer) clearInterval(room.flushTimer);
    rooms.delete(room.code);
    roomsByToken.delete(room.token);
  });
}

function roomByToken(token: string | null): Room | undefined {
  if (!token) return undefined;
  return roomsByToken.get(token);
}

function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    req.on('data', (c: Buffer) => {
      if (done) return;
      total += c.length;
      if (total > max) {
        done = true;
        resolve(null);
        req.resume(); // drain so the caller can still write the 413 response
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks));
      }
    });
    req.on('error', () => {
      if (!done) {
        done = true;
        resolve(null);
      }
    });
  });
}

function baseFile(code: string): string {
  return path.join(BASE_DIR, `${code}.aep`);
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/health') {
    const totalOps = [...rooms.values()].reduce((sum, r) => sum + r.seq, 0);
    const totalPeers = [...rooms.values()].reduce((sum, r) => sum + r.peers.size, 0);
    const mem = process.memoryUsage();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      proto: PROTOCOL_VERSION,
      rooms: rooms.size,
      peers: totalPeers,
      totalOps,
      uptimeSec: Math.round(process.uptime()),
      memory: { rss: Math.round(mem.rss / 1024 / 1024), heapUsed: Math.round(mem.heapUsed / 1024 / 1024) },
    }));
    return;
  }
  const roomMatch = /^\/rooms\/([A-Za-z0-9]{4,8})$/.exec(url.pathname);
  if (roomMatch) {
    const code = roomMatch[1]!.toUpperCase();
    const room = rooms.get(code);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code, exists: Boolean(room), members: room ? room.peers.size : 0, seq: room ? room.seq : 0 }));
    return;
  }
  // Paged op history, streamed from the persisted log (not just the in-memory
  // window), so a client that missed more than `welcome` can replay in order.
  // All routes require the room token issued in `welcome`.
  if (url.pathname === '/ops') {
    const room = roomByToken(url.searchParams.get('token'));
    if (!room) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
    const beforeRaw = Number(url.searchParams.get('before'));
    const before = Number.isFinite(beforeRaw) && beforeRaw > 0 ? beforeRaw : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 5000) || 0, 1), 20000);
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'x-last-seq': String(room.seq) });
    void (async () => {
      let sent = 0;
      try {
        const rl = createInterface({
          input: createReadStream(path.join(DATA_DIR, `${room.code}.jsonl`)),
          crlfDelay: Infinity,
        });
        for await (const line of rl) {
          if (!line.trim()) continue;
          let entry: LoggedOp;
          try {
            entry = JSON.parse(line) as LoggedOp;
          } catch {
            continue;
          }
          if (entry.seq <= after || entry.seq >= before) continue;
          res.write(line + '\n');
          if (++sent >= limit) {
            rl.close();
            break;
          }
        }
      } catch {}
      res.end();
    })();
    return;
  }
  // Base project sharing. All routes require the room token issued in `welcome`.
  if (url.pathname === '/base/meta') {
    const room = roomByToken(url.searchParams.get('token'));
    if (!room) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ base: room.base }));
    return;
  }
  if (url.pathname === '/base') {
    const room = roomByToken(url.searchParams.get('token'));
    if (!room) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'forbidden' }));
      return;
    }
    if (req.method === 'GET') {
      if (!room.base) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'no_base' }));
        return;
      }
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(room.base.size),
        'x-base-name': room.base.name,
        'x-base-hash': room.base.hash,
      });
      const stream = createReadStream(baseFile(room.code));
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const declared = Number(req.headers['content-length'] ?? NaN);
      if (Number.isFinite(declared) && declared > MAX_BASE_BYTES) {
        res.writeHead(413, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'too_large', max: MAX_BASE_BYTES }));
        req.resume();
        return;
      }
      const rawSeq = url.searchParams.get('seq');
      const checkpoint = rawSeq === null ? room.seq : Number(rawSeq);
      if (rawSeq !== null && (!/^\d+$/.test(rawSeq) || !Number.isSafeInteger(checkpoint))) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'bad_checkpoint' }));
        req.resume();
        return;
      }
      if (rawSeq !== null && (checkpoint > room.seq || checkpoint < room.baseSeq)) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'stale_or_future_checkpoint' }));
        req.resume();
        return;
      }
      if (room.baseUploading) {
        res.writeHead(409, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'base_upload_in_progress' }));
        req.resume();
        return;
      }
      const nowPut = Date.now();
      if (nowPut - room.lastBasePut < 1500) {
        res.writeHead(429, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'too_frequent' }));
        req.resume();
        return;
      }
      if (baseUploadsInFlight >= MAX_CONCURRENT_UPLOADS) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'busy' }));
        req.resume();
        return;
      }
      room.lastBasePut = nowPut;
      room.baseUploading = true;
      room.reservations++;
      baseUploadsInFlight++;
      void (async () => {
        const suffix = '.tmp-' + randomUUID();
        const bodyTemp = baseFile(room.code) + suffix;
        const metaFile = path.join(BASE_DIR, `${room.code}.json`);
        const metaTemp = metaFile + suffix;
        try {
          const body = await readBody(req, MAX_BASE_BYTES);
          if (body === null) {
            res.writeHead(413, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'too_large', max: MAX_BASE_BYTES }));
            return;
          }
          if (body.length === 0) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'empty_body' }));
            return;
          }
          const name = (url.searchParams.get('name') ?? 'base.aep').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'base.aep';
          const aeVersion = (url.searchParams.get('ae') ?? '').replace(/[^\w.\- ]/g, '').slice(0, 16);
          const meta: BaseInfo = {
            name,
            size: body.length,
            hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
            uploadedBy: (url.searchParams.get('by') ?? 'unknown').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 24) || 'unknown',
            uploadedAt: Date.now(),
            aeVersion: aeVersion || undefined,
          };
          if (rawSeq !== null) meta.seq = checkpoint;
          await mkdir(BASE_DIR, { recursive: true });
          await writeFile(bodyTemp, body);
          await writeFile(metaTemp, JSON.stringify(meta));
          await rename(bodyTemp, baseFile(room.code));
          await rename(metaTemp, metaFile);
          room.base = meta;
          room.baseSeq = checkpoint;
          await saveBaseSeq(room.code, room.baseSeq);
          broadcast(room, { t: 'base', base: meta });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, base: meta }));
        } catch {
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'base_write_failed' }));
          } else res.destroy();
        } finally {
          await Promise.allSettled([unlink(bodyTemp), unlink(metaTemp)]);
          baseUploadsInFlight--;
          room.baseUploading = false;
          room.reservations--;
          releaseRoom(room);
        }
      })();
      return;
    }
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'method_not_allowed' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

// 128 KB was too tight: a large op (e.g. a shape tree / mask path) could exceed
// it and WebSocket would close the socket (1009). Ops stay small in practice;
// this is headroom. Message rate limiting still bounds throughput.
const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });

httpServer.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const peer: Peer = {
    id: randomUUID().slice(0, 8),
    socket: ws,
    info: null,
    room: null,
    cursor: null,
    cursorDirty: false,
    msgCount: 0,
    windowStart: nowMs(),
    alive: true,
    joining: false,
    closed: false,
    pendingIds: new Set(),
    receipts: new Map(),
  };
  const helloTimer = setTimeout(() => {
    if (!peer.info && !peer.joining) ws.close(1008, 'hello timeout');
  }, HELLO_TIMEOUT_MS);

  ws.on('message', (raw) => {
    if (rateLimited(peer)) {
      send(ws, { t: 'error', code: 'rate_limited', message: 'too many messages' });
      ws.close(1008, 'rate limited');
      return;
    }
    handleMessage(peer, raw.toString());
  });
  ws.on('pong', () => {
    peer.alive = true;
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    closePeer(peer);
  });
  ws.on('error', () => {
    clearTimeout(helloTimer);
    closePeer(peer);
  });
});

const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const peer of room.peers.values()) {
      if (!peer.alive) {
        peer.socket.terminate();
        continue;
      }
      peer.alive = false;
      peer.socket.ping();
    }
  }
}, HEARTBEAT_MS);

async function sweepOldLogs(): Promise<void> {
  const now = Date.now();
  const groups = new Map<string, Array<{ file: string; token: boolean; state: boolean }>>();
  for (const directory of [DATA_DIR, BASE_DIR]) {
    try {
      for (const name of await readdir(directory)) {
        const ext = path.extname(name);
        if (directory === DATA_DIR ? ext !== '.jsonl' : !['.aep', '.json', '.token', '.seq'].includes(ext)) continue;
        const code = name.slice(0, -ext.length);
        const files = groups.get(code) ?? [];
        files.push({ file: path.join(directory, name), token: ext === '.token', state: ext !== '.token' && ext !== '.seq' });
        groups.set(code, files);
      }
    } catch {}
  }
  for (const [code, files] of groups) {
    if (rooms.has(code) || pendingRooms.has(code) || sweepingRooms.has(code)) continue;
    const sweeping = (async (): Promise<void> => {
      try {
        const ages = await Promise.all(files.map(async (entry) => {
          try { return { ...entry, old: now - (await stat(entry.file)).mtimeMs > LOG_MAX_AGE_MS }; }
          catch { return null; }
        }));
        const retained = ages.some((entry) => entry !== null && entry.state && !entry.old);
        for (const entry of ages) {
          if (!entry || !entry.old || (entry.token && retained)) continue;
          try {
            await rm(entry.file);
            console.log(`[vynk] swept old room file: ${path.basename(entry.file)}`);
          } catch {}
        }
      } finally {
        sweepingRooms.delete(code);
      }
    })();
    sweepingRooms.set(code, sweeping);
    await sweeping;
  }
}

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(BASE_DIR, { recursive: true });
  await sweepOldLogs();
  setInterval(sweepOldLogs, LOG_SWEEP_INTERVAL_MS);
  httpServer.listen(PORT, () => {
    console.log(`[vynk] relay listening on :${PORT} (ws path /ws, health /health)`);
  });
}

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      if (room.flushTimer) clearInterval(room.flushTimer);
    }
    // Flush pending op-log appends before exiting so the last ops persist.
    const chains = [...rooms.values()].map((r) => r.writeChain);
    Promise.allSettled(chains).finally(() => {
      httpServer.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 500);
    });
  });
}

void main();
