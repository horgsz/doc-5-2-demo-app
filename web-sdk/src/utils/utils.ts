export const TIME_TO_KEEP_SUCCESS_CHECK_ANIMATION_ON_IN_MS = 4000;

export async function sleep(timeoutMS: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMS));
}

export function classNames(...props: any): string {
  let classNames: string = '';
  props.forEach((c: string) => c && (classNames += c + ' '));
  return classNames;
}

export function createBlobUrlFromImageData(imageData: ImageData): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create a canvas
    const canvas = document.createElement('canvas');
    canvas.width = imageData.width;
    canvas.height = imageData.height;

    // Put the ImageData on the canvas
    const ctx = canvas.getContext('2d');
    ctx.putImageData(imageData, 0, 0);

    // Convert the canvas to a Blob (asynchronously)
    canvas.toBlob(blob => {
      if (blob) {
        // Create a URL from the Blob
        const blobUrl = URL.createObjectURL(blob);
        resolve(blobUrl);
      } else {
        reject('Failed to create blob');
      }
    });
  });
}

export function isExternalUrl(path: string) {
  try {
    new URL(path);
    return true;
  } catch (e) {
    return false;
  }
}
