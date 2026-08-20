const IMAGE_MAX_WIDTH = 2000;
const IMAGE_MAX_HEIGHT = 2000;
export const IMAGE_TARGET_BYTES = (15 * 1024 * 1024) / 4;

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(dataUrl.trim());
  if (!match) throw new Error('截图格式无效，请重新截取');

  let binary: string;
  try {
    binary = atob(match[2].replace(/\s/g, ''));
  } catch {
    throw new Error('截图数据无效，请重新截取');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1].toLowerCase() });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('截图无法解码，请重新截取'));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('截图处理失败，请重新截取')),
      type,
      quality,
    );
  });
}

export async function prepareImageUpload(dataUrl: string): Promise<Blob> {
  const original = dataUrlToBlob(dataUrl);
  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    IMAGE_MAX_WIDTH / image.naturalWidth,
    IMAGE_MAX_HEIGHT / image.naturalHeight,
  );

  if (scale === 1 && original.size <= IMAGE_TARGET_BYTES) return original;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法处理截图');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const png = await canvasToBlob(canvas, 'image/png');
  if (png.size <= IMAGE_TARGET_BYTES) return png;

  const jpegCanvas = document.createElement('canvas');
  jpegCanvas.width = canvas.width;
  jpegCanvas.height = canvas.height;
  const jpegContext = jpegCanvas.getContext('2d');
  if (!jpegContext) throw new Error('浏览器无法压缩截图');
  jpegContext.fillStyle = '#ffffff';
  jpegContext.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
  jpegContext.drawImage(canvas, 0, 0);
  const jpeg = await canvasToBlob(jpegCanvas, 'image/jpeg', 0.88);
  if (jpeg.size > IMAGE_TARGET_BYTES) {
    throw new Error('图片压缩后仍然过大，请重新拍摄或选择较小的图片');
  }
  return jpeg;
}
