/**
 * File Uploader
 *
 * A class to handle file uploads in the background using the fetch API.
 * It supports multiple concurrent uploads and provides a method to check if all uploads are complete.
 */

/**
 * How long completion waits for the engine to hand over the last upload (the
 * session video) once the scan is over. The hand-over is local -- encrypt and
 * post a buffer -- and takes milliseconds; this only bounds the case where it
 * never comes (no upload link for it, an engine gap), which used to leave the
 * success screen up for good with no event to the host.
 */
export const LAST_UPLOAD_TIMEOUT_MS = 30000;

export class FileUploader {
  // Array to store all ongoing upload promises
  private uploads: Promise<unknown>[] = [];
  private lastUploadHasArrived: boolean = false;

  /**
   * Upload a file using fetch in the background.
   *
   * @param url - The URL to which the file should be uploaded.
   * @param data - The file data (Blob) to be uploaded.
   * @param isLastUpload - The upload that completes the scan (the session video).
   */
  public uploadFile(url: string, data: Blob, isLastUpload: boolean): void {
    // Counted before anything can go wrong with it: completion waits for this
    // upload, and must hear that it came even when it cannot be sent.
    if (isLastUpload) {
      this.lastUploadHasArrived = true;
    }

    if (!url || !data || !data.size) {
      // Nowhere to send it (no link left) or nothing to send: a failed upload,
      // reported when completion is checked rather than thrown at nobody.
      this.track(Promise.reject(new Error('Invalid upload request.')));
      return;
    }

    // fetch() only rejects when the request could not be made. Storage
    // refusing it -- an expired link, a 5xx -- is a failed upload too, not one
    // to report as done.
    this.track(
      fetch(url, {
        method: 'PUT',
        body: data,
        headers: {
          'Content-Type': data.type, // Set the content type to the Blob's type
        },
      }).then(response => {
        if (!response.ok) {
          throw new Error(`Upload failed: HTTP ${response.status}`);
        }
        return response;
      }),
    );
  }

  /**
   * Check if all uploads are complete.
   *
   * @param expectLastUpload - Whether the engine will hand over a last upload
   *   (the session video). False when no recording was handed to it, so
   *   completion does not wait for an upload that will never come.
   * @returns A promise that resolves to true if all uploads are done, otherwise false.
   */
  public async areAllUploadsComplete(expectLastUpload: boolean = true): Promise<boolean> {
    if (expectLastUpload && !(await this.waitForCondition(() => this.lastUploadHasArrived, LAST_UPLOAD_TIMEOUT_MS))) {
      return false;
    }

    // Wait for all promises to either resolve or reject
    let results = await Promise.allSettled(this.uploads);

    const isAllUploadsComplete = results.every(result => result.status === 'fulfilled');

    return isAllUploadsComplete;
  }

  /**
   * Clear all uploads from the uploads array.
   */
  public clearUploads(): void {
    this.uploads = [];
    this.lastUploadHasArrived = false;
  }

  /** Keeps an upload for areAllUploadsComplete, which is where its failure is judged. */
  private track(upload: Promise<unknown>): void {
    upload.catch(() => {}); // not unhandled in the meantime
    this.uploads.push(upload);
  }

  /** Resolves true once `checkFn` holds, or false after `timeoutMs`. */
  private waitForCondition(checkFn: () => boolean, timeoutMs: number, interval: number = 100): Promise<boolean> {
    return new Promise(resolve => {
      if (checkFn()) {
        resolve(true);
        return;
      }

      const started = Date.now();
      const id = setInterval(() => {
        if (checkFn()) {
          clearInterval(id);
          resolve(true);
        } else if (Date.now() - started >= timeoutMs) {
          clearInterval(id);
          resolve(false);
        }
      }, interval);
    });
  }
}
