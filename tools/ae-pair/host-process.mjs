import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const query = fileURLToPath(new URL('./host-process.ps1', import.meta.url));
const executableKey = exe => {
  if (typeof exe !== 'string' || !path.win32.isAbsolute(exe)) throw Error('AE executable must be an absolute Windows path');
  return path.win32.normalize(exe).toLowerCase();
};

export function selectHostProcess(processes, executable) {
  const expected = executableKey(executable);
  for (const candidate of processes) {
    if (!Number.isInteger(candidate.pid) || candidate.pid <= 0 || !candidate.executable) throw Error('Cannot identify an After Effects process safely');
  }
  const matches = processes.filter(candidate => executableKey(candidate.executable) === expected);
  if (matches.length > 1) throw Error('More than one After Effects process uses ' + executable);
  return matches[0] || null;
}

export function listAEProcesses() {
  const text = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', query], { encoding: 'utf8', windowsHide: true }).trim();
  const processes = JSON.parse(text);
  if (!Array.isArray(processes)) throw Error('Invalid After Effects process inventory');
  return processes;
}

export function hostProcess(executable) {
  return selectHostProcess(listAEProcesses(), executable);
}

export function ownedHostProcess(processes, executable, recordedPid) {
  const host = selectHostProcess(processes, executable);
  if (!host || !Number.isInteger(recordedPid) || host.pid !== recordedPid) throw Error('After Effects process does not match saved ownership');
  return host;
}

export function validateHosts(hosts) {
  if (executableKey(hosts.A.exe) === executableKey(hosts.B.exe)) throw Error('Pair hosts must use different After Effects executables');
  if (hosts.A.ver === hosts.B.ver) throw Error('Pair hosts must use different AE version keys');
}
