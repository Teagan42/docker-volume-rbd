import type RbdType from '../src/rbd';

type ExecCall = { stdout?: string; stderr?: string; error?: Error };

async function loadRbdWithMock(execSequence: ExecCall[]) {
  // Fresh module instance each time
  jest.resetModules();

  const execMock = jest.fn(async () => {
    const call = execSequence.shift();
    if (!call) {
      throw new Error('execFile called too many times');
    }
    if (call.error) throw call.error;
    return { stdout: call.stdout ?? '', stderr: call.stderr ?? '' };
  });

  jest.doMock('util', () => {
    const actual = jest.requireActual('util');
    return { ...actual, promisify: () => execMock };
  });

  const mod = await import('../src/rbd');
  const Rbd = mod.default as typeof RbdType;
  return { Rbd, execMock };
}

const baseOptions = {
  pool: 'rbd',
  cluster: 'ceph',
  user: 'client.test',
  map_options: ['--exclusive'],
  order: '22',
  rbd_options: 'layering',
};

describe('Rbd command helpers', () => {
  test('isMapped finds device from keyed JSON', async () => {
    const { Rbd, execMock } = await loadRbdWithMock([
      {
        stdout: JSON.stringify([
          { id: '1', pool: 'rbd', namespace: '', name: 'vol1', snap: '-', device: '/dev/rbd1' },
          { id: '2', pool: 'other', namespace: '', name: 'vol2', snap: '-', device: '/dev/rbd2' },
        ]),
      },
    ]);

    const rbd = new Rbd(baseOptions);
    const device = await rbd.isMapped('vol1');

    expect(device).toBe('/dev/rbd1');
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  test('isMapped returns null when not found', async () => {
    const { Rbd } = await loadRbdWithMock([{ stdout: JSON.stringify([]) }]);
    const rbd = new Rbd(baseOptions);
    const device = await rbd.isMapped('missing');
    expect(device).toBeNull();
  });

  test('list parses array JSON output', async () => {
    const list = [{ image: 'vol1', id: '1', size: 2048, format: 2 }];
    const { Rbd, execMock } = await loadRbdWithMock([{ stdout: JSON.stringify(list) }]);

    const rbd = new Rbd(baseOptions);
    const res = await rbd.list();

    expect(res).toEqual(list);
    expect(execMock).toHaveBeenCalledTimes(1);
  });

  test('makeFilesystem forwards options verbatim', async () => {
    const { Rbd, execMock } = await loadRbdWithMock([{ stdout: '' }]);
    const rbd = new Rbd(baseOptions);

    await rbd.makeFilesystem('xfs', '/dev/rbd1', '-m crc=1 -n ftype=1');

    expect(execMock).toHaveBeenCalledTimes(1);
    const firstCall = execMock.mock.calls[0] as any;
    const args = (firstCall?.[1] ?? []) as string[];
    expect(args).toEqual(['-t', 'xfs', 'fs-options', '-m', 'crc=1', '-n', 'ftype=1', '/dev/rbd1']);
  });
});

