import { describe, expect, it } from 'vitest';
import { detectShells, resolveShell } from './shell-registry';

const existsIn = (paths: string[]) => (path: string) => paths.includes(path);

describe('シェル許可リスト（RDD 9.2章）', () => {
  it('Linux: 実在するシェルのみを検出する', () => {
    const shells = detectShells('linux', { SHELL: '/usr/bin/zsh' }, existsIn(['/bin/bash', '/usr/bin/zsh']));
    expect(shells.map((s) => s.id)).toEqual(['bash', 'zsh']);
    expect(shells.find((s) => s.id === 'bash')?.path).toBe('/bin/bash');
  });

  it('存在しない候補（fish等）は含まれない', () => {
    const shells = detectShells('linux', {}, existsIn(['/bin/bash', '/bin/sh']));
    expect(shells.map((s) => s.id)).toEqual(['bash', 'sh']);
    expect(shells.find((s) => s.id === 'fish')).toBeUndefined();
  });

  it('$SHELL が候補一覧外のパスでも検出対象に含める（重複はしない）', () => {
    const shells = detectShells(
      'linux',
      { SHELL: '/opt/custom/mysh' },
      existsIn(['/bin/bash', '/opt/custom/mysh']),
    );
    expect(shells.map((s) => s.id)).toContain('mysh');
    expect(shells.filter((s) => s.id === 'bash')).toHaveLength(1);
  });

  it('resolveShell: 許可リスト内のidのみ解決し、リスト外・パス文字列はundefined', () => {
    const registry = detectShells('linux', {}, existsIn(['/bin/bash', '/usr/bin/zsh']));
    expect(resolveShell('bash', registry)?.path).toBe('/bin/bash');
    expect(resolveShell('fish', registry)).toBeUndefined();
    expect(resolveShell('/bin/evil', registry)).toBeUndefined();
    expect(resolveShell('../bash', registry)).toBeUndefined();
  });
});
