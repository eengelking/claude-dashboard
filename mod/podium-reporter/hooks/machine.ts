// Which machine a session runs on (issue #34). Pure: the mod passes in what `hostname` printed and a
// random source. The id is random and kept in the mod's own store, so two machines that share a host
// name stay apart and nothing about the hardware is read.
import type { MachineInfo } from './protocol.ts';

/** The `$.store` key the machine id is kept under. */
export const MACHINE_ID_KEY = 'machineId';
const HOST_MAX = 64;

/** The short host name from `hostname` output: the first line, up to the first dot (`Eds-MBP.local` is `Eds-MBP`). Null when empty. */
export function hostOf(stdout: string | null | undefined): string | null {
  const line = (stdout ?? '').split(/\r?\n/)[0] ?? '';
  // eslint-disable-next-line no-control-regex
  const host = line.replace(/[\u0000-\u001f\u007f]/g, '').trim().split('.')[0]!.trim();
  return host ? host.slice(0, HOST_MAX) : null;
}

/** A stored id this reporter made: 8 to 32 lowercase hex characters. */
export function isMachineId(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8,32}$/.test(v);
}

/** A new random id of 12 hex characters. */
export function newMachineId(random: () => number): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += Math.floor(random() * 16).toString(16);
  return s;
}

/** The machine as the report carries it; a host with no name is labelled by its id. */
export function machineInfo(host: string | null, id: string): MachineInfo {
  return { name: host ?? `machine-${id.slice(0, 4)}`, id };
}
