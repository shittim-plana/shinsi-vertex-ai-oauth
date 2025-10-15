import { ref, uploadBytes, getDownloadURL, StorageReference } from 'firebase/storage';
import { storage } from '@/firebase/config'; // Assuming firebase config is here
import { v4 as uuidv4 } from 'uuid';

/**
 * Converts a Firebase Storage URL to use our proxy to avoid CORS issues in development/test.
 * In production, returns the original URL assuming CORS is configured.
 * @param storageUrl - Original Firebase Storage URL (gs:// or https://)
 * @returns Proxied URL (development/test) or original URL (production). Returns empty string if input is null/undefined.
 */
export function getProxiedStorageUrl(storageUrl: string | null | undefined): string {
  if (!storageUrl) return '';
  
  // If we're in development or testing environment, use the proxy
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    // Encode the original URL to pass as a query parameter
    const encodedUrl = encodeURIComponent(storageUrl);
    return `/api/storage-proxy?url=${encodedUrl}`;
  }
  
  // In production, CORS should be properly configured
  return storageUrl;
}

/**
 * Creates a URL for a file in Firebase Storage
 * @param path - Path to the file in Firebase Storage
 * @returns Proxied URL that avoids CORS issues
 */
export function getStorageFileUrl(): Promise<string> {
  // This is a placeholder for when you need to get a file URL from Storage
  // You would typically use getDownloadURL from Firebase Storage here
  // and then pass the result to getProxiedStorageUrl
  return Promise.resolve('')
    .then(url => getProxiedStorageUrl(url));
}

/**
 * Uploads a file to Firebase Storage and returns the proxied download URL.
 * Generates a unique filename using UUID.
 * @param file - The file to upload.
 * @param pathPrefix - The path prefix in Firebase Storage (e.g., 'characters/').
 * @returns A promise that resolves with the proxied download URL.
 * @throws Throws an error if the upload fails.
 */
export async function uploadFileAndGetUrl(file: File, pathPrefix: string, filenameHint?: string): Promise<string> {
  if (!file) {
    throw new Error("No file provided for upload.");
  }
  // Consider adding file type/size validation here

  const fileExtension = file.name.split('.').pop();

  // Build safe filename prefix from hint (keeps Korean/English letters, numbers, _.-, replaces spaces with -)
  const safe = (s: string) =>
    (s || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^0-9a-zA-Z가-힣._-]/g, '');

  const prefix = filenameHint ? safe(filenameHint) : '';
  const uniqueFilename = `${prefix ? prefix + '-' : ''}${uuidv4()}${fileExtension ? '.' + fileExtension : ''}`;
  const storageRef: StorageReference = ref(storage, `${pathPrefix}${uniqueFilename}`);

  try {
    await uploadBytes(storageRef, file);
    const directDownloadUrl = await getDownloadURL(storageRef);
    return getProxiedStorageUrl(directDownloadUrl);
  } catch (error) {
    console.error(`Error uploading file to ${pathPrefix}:`, error);
    throw new Error(`Failed to upload file: ${file.name}`); // Re-throw a more specific error
  }
}

/**
 * Converts a data URL (e.g., from canvas or FileReader) to a File object.
 * @param dataUrl - The data URL string.
 * @param filename - The desired filename for the new File object.
 * @returns A promise that resolves with the created File object.
 */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  // Determine the file type from the blob, default to jpeg if needed
  const mimeType = blob.type || 'image/jpeg';
  // Ensure filename has an appropriate extension if missing
  let finalFilename = filename;
  if (!/\.[^/.]+$/.test(filename)) { // Check if filename lacks extension
      const extension = mimeType.split('/')[1] || 'jpg'; // Get extension from MIME type
      finalFilename = `${filename}.${extension}`;
  }

  return new File([blob], finalFilename, { type: mimeType });
}