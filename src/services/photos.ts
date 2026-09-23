export function validatePhoto(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('JPG, PNG, WEBP 사진만 올릴 수 있어요.');
  if (file.size > 5 * 1024 * 1024) throw new Error('사진은 한 장에 5MB 이하로 올려 주세요.');
}
// Decode before upload; resize removes EXIF and keeps demo storage manageable.
export async function preparePhoto(file: File): Promise<File> {
  validatePhoto(file);
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('손상되었거나 읽을 수 없는 사진이에요.');
  });
  try {
    const ratio = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('사진을 처리하지 못했어요.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (v) => (v ? resolve(v) : reject(new Error('사진 변환에 실패했어요.'))),
        'image/jpeg',
        0.78,
      ),
    );
    return new File([blob], 'room-photo.jpg', { type: 'image/jpeg' });
  } finally {
    bitmap.close();
  }
}
