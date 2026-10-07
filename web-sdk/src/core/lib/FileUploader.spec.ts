/**
 * Completion of a scan's uploads.
 *
 * Found by the simulator: with recording off, a finished scan sat on the
 * success screen for good -- completion waited for a last upload (the session
 * video) that was never coming, with no timeout and no event to the host. A
 * last upload that could not be sent waited the same way, and storage refusing
 * an upload (HTTP 500) was reported as success.
 */
import { FileUploader, LAST_UPLOAD_TIMEOUT_MS } from './FileUploader';

const blob = (n = 8) => ({ size: n, type: 'image/jpeg' } as unknown as Blob);
const answer = (status: number) => Promise.resolve({ ok: status >= 200 && status < 300, status } as Response);

describe('FileUploader.areAllUploadsComplete()', () => {
  beforeEach(() => {
    (global as any).fetch = jest.fn(() => answer(200));
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('with no recording handed over, does not wait for a last upload', async () => {
    const up = new FileUploader();
    up.uploadFile('https://s3/a', blob(), false);
    await expect(up.areAllUploadsComplete(false)).resolves.toBe(true);
  });

  it('completes once the last upload arrives and everything is stored', async () => {
    const up = new FileUploader();
    up.uploadFile('https://s3/a', blob(), false);
    up.uploadFile('https://s3/video', blob(), true);
    await expect(up.areAllUploadsComplete()).resolves.toBe(true);
  });

  it('gives up on a last upload that never comes, instead of waiting forever', async () => {
    jest.useFakeTimers();
    const up = new FileUploader();
    up.uploadFile('https://s3/a', blob(), false);
    const done = up.areAllUploadsComplete();
    jest.advanceTimersByTime(LAST_UPLOAD_TIMEOUT_MS + 200);
    await expect(done).resolves.toBe(false);
  });

  it('a last upload with no link is a failure, not a hang', async () => {
    const up = new FileUploader();
    expect(() => up.uploadFile('', blob(), true)).not.toThrow();
    await expect(up.areAllUploadsComplete()).resolves.toBe(false);
  });

  it('an empty last upload is a failure, not a hang', async () => {
    const up = new FileUploader();
    up.uploadFile('https://s3/video', blob(0), true);
    await expect(up.areAllUploadsComplete()).resolves.toBe(false);
  });

  it('storage refusing an upload (HTTP 500) is a failure', async () => {
    (global as any).fetch = jest.fn((url: string) => answer(url.endsWith('/a') ? 500 : 200));
    const up = new FileUploader();
    up.uploadFile('https://s3/a', blob(), false);
    up.uploadFile('https://s3/video', blob(), true);
    await expect(up.areAllUploadsComplete()).resolves.toBe(false);
  });

  it('a network failure is a failure', async () => {
    (global as any).fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const up = new FileUploader();
    up.uploadFile('https://s3/video', blob(), true);
    await expect(up.areAllUploadsComplete()).resolves.toBe(false);
  });
});
