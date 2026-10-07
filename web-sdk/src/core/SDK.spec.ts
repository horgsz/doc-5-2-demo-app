/**
 * Regression guard for the transient worker-load retry.
 *
 * The worker + wasm load lazily when a scan starts. `new Worker(url, {type:
 * 'module'})` can fail transiently -- a dropped fetch of the worker script
 * fires worker.onerror before the wasm even begins to load, which is why the
 * same URLs probe 200 a moment later. load() now recreates the worker a few
 * times before surfacing the failure, and the failure it surfaces carries the
 * real ErrorEvent detail instead of a bare "Failed to load the worker."
 *
 * Both behaviours are locked here against the REAL SDKManager (its onerror is
 * what turns an ErrorEvent into the rejection load() retries on).
 */
import { load } from './SDK';
import { ErrorCode } from './lib/SdkError';
import { SdkType } from './lib/Interfaces';
import SDKManager from './SDKManager';

// getWasmMode decides which module_urls entry load() reads; pin it to simd.
jest.mock('./lib/Helper', () => ({
  ...jest.requireActual('./lib/Helper'),
  getWasmMode: () => Promise.resolve('simd'),
}));

// One behaviour per worker-creation attempt.
let attempts: Array<'fail' | 'ok'>;
let attemptIdx: number;
const created: FakeWorker[] = [];

/**
 * Stand-in for the browser Worker. A 'fail' attempt fires onerror on a later
 * macrotask -- well after SDKManager's constructor has wired it -- to mimic a
 * worker that never starts. A macrotask (not a microtask) because load() now
 * awaits the script fetch before creating the worker, so a microtask-timed
 * onerror would fire during that await gap, before onerror is wired; a real
 * worker's onerror follows a real network round-trip and lands much later.
 * 'ok' just sits there and lets loadWasmModule resolve.
 */
class FakeWorker {
  onmessage: any = null;
  onerror: ((e: any) => void) | null = null;
  terminate = jest.fn();
  constructor(_url: string, _opts?: any) {
    created.push(this);
    if (attempts[attemptIdx] === 'fail') {
      setTimeout(
        () =>
          this.onerror?.({
            message: 'boom',
            filename: 'IDVerseSDK.worker.min.js',
            lineno: 1,
            colno: 2,
          }),
        0,
      );
    }
  }
}

function makeSettings(): any {
  const key = `${SdkType.IDScan}/simd`;
  return {
    sdkType: SdkType.IDScan,
    session: {} as any,
    permission: {
      engines_base_url: '',
      engines_signed_query: '',
      assets_upload_links: [],
      assets_public_encryption_key: '',
      engine_payload: '',
      module_urls: { [key]: { engine: 'e.wasm', data: 'd.data', loader: 'l.js' } },
    },
  };
}

describe('SDK.load() -- retry a transient worker-load failure', () => {
  beforeEach(() => {
    attempts = [];
    attemptIdx = 0;
    created.length = 0;
    (global as any).Worker = FakeWorker as any;

    // load() now fetches the worker script itself and instantiates from a Blob
    // URL (so a dropped script fetch is a diagnosable, retryable fetch rather
    // than an opaque worker.onerror). Stub both so createWorker() reaches the
    // FakeWorker on each attempt.
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('/* worker */') });
    (global as any).URL.createObjectURL = jest.fn(() => 'blob:mock-worker');
    (global as any).URL.revokeObjectURL = jest.fn();

    // Never actually loads a wasm module: a 'fail' attempt is rejected by
    // worker.onerror, so keep loadWasmModule pending there and let onerror win;
    // an 'ok' attempt resolves it to the manager. attemptIdx advances here, in
    // lockstep with the FakeWorker created for the same attempt.
    jest.spyOn(SDKManager.prototype, 'loadWasmModule').mockImplementation(function (this: any) {
      const behaviour = attempts[attemptIdx];
      attemptIdx++;
      return behaviour === 'ok' ? Promise.resolve(this) : new Promise(() => {});
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('recreates the worker and succeeds when the first start fails', async () => {
    attempts = ['fail', 'ok'];

    const mgr = await load(makeSettings(), 'worker.js', undefined as any);

    expect(mgr).toBeInstanceOf(SDKManager);
    expect(created).toHaveLength(2);
    expect(created[0].terminate).toHaveBeenCalledTimes(1); // failed worker cleaned up
    expect(created[1].terminate).not.toHaveBeenCalled(); // the one that succeeded is kept
  });

  it('gives up after MAX attempts and surfaces the real error detail', async () => {
    attempts = ['fail', 'fail', 'fail', 'fail'];

    await expect(load(makeSettings(), 'worker.js', undefined as any)).rejects.toMatchObject({
      code: ErrorCode.WorkerLoadFailure,
      message: expect.stringContaining('boom'),
    });

    expect(created).toHaveLength(4); // MAX_WORKER_LOAD_ATTEMPTS
    created.forEach(w => expect(w.terminate).toHaveBeenCalledTimes(1));
  });

  it('does not retry once the worker has loaded', async () => {
    attempts = ['ok'];

    await load(makeSettings(), 'worker.js', undefined as any);

    expect(created).toHaveLength(1);
    expect(created[0].terminate).not.toHaveBeenCalled();
  });

  it('retries a dropped worker-script fetch and recovers', async () => {
    attempts = ['ok'];
    // First fetch fails (503), the retry serves the script.
    let call = 0;
    (global as any).fetch = jest.fn().mockImplementation(() => {
      call++;
      return call === 1
        ? Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') })
        : Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('/* worker */') });
    });

    const mgr = await load(makeSettings(), 'worker.js', undefined as any);

    expect(mgr).toBeInstanceOf(SDKManager);
    // The failed fetch never got as far as creating a worker; the retry did.
    expect(created).toHaveLength(1);
  });

  it('surfaces the HTTP status when the worker script never loads (not an opaque error)', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503, text: () => Promise.resolve('') });

    await expect(load(makeSettings(), 'worker.js', undefined as any)).rejects.toMatchObject({
      code: ErrorCode.WorkerLoadFailure,
      message: expect.stringContaining('503'),
    });

    expect(created).toHaveLength(0); // failed before any worker was created
  });
});
