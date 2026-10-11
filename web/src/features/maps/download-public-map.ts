import { siteUrl } from "../pages/site-data.js";

/** Encode the lossless display copy on demand, including when it is cached offline. */
export async function downloadPublicMap(path: '/map.webp' | '/evacuation-map.webp', filename: string): Promise<void> {
  const controller = new AbortController();
  const deadline = window.setTimeout(() => controller.abort(), 10_000);
  let bytes: Blob;
  try {
    const response = await fetch(siteUrl(path), { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error('The map is not available yet. Wait for it to load and try again.');
    bytes = await response.blob();
  } finally {
    window.clearTimeout(deadline);
  }
  const sourceUrl = URL.createObjectURL(bytes);
  const image = new Image();
  try {
    image.src = sourceUrl;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context || !canvas.width || !canvas.height) throw new Error('This browser could not prepare the PNG download.');
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The PNG could not be created.')), 'image/png');
    });
    const downloadUrl = URL.createObjectURL(png);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.append(link);
    try { link.click(); }
    finally {
      link.remove();
      // Let the browser take ownership of the download before releasing its URL.
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
