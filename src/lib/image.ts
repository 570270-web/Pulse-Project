/**
 * 채팅 사진 첨부 준비.
 * 휴대폰 사진은 수 MB 라서 그대로 올리면 느리고 저장소도 금방 찬다.
 * 긴 변 1600px 이하로 줄여 webp 로 다시 인코딩하고, 실패하면 원본을 쓴다.
 */

/** 버킷 제한과 같은 값 (마이그레이션 0003) */
const MAX_BYTES = 5 * 1024 * 1024;
/** 화면에서 크게 볼 일이 없는 크기까지만 남긴다 */
const MAX_SIDE = 1600;
const QUALITY = 0.85;

export const MAX_IMAGE_MB = MAX_BYTES / (1024 * 1024);

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type PreparedImage =
  | { ok: true; blob: Blob; ext: string }
  | { ok: false; reason: 'type' | 'size' };

export async function prepareImage(file: File): Promise<PreparedImage> {
  const ext = EXTENSIONS[file.type];

  if (!ext) return { ok: false, reason: 'type' };
  if (file.size > MAX_BYTES) return { ok: false, reason: 'size' };

  // GIF 는 움직임을 살리려고 원본 그대로 올린다
  if (file.type === 'image/gif') return { ok: true, blob: file, ext: 'gif' };

  try {
    const bitmap = await createImageBitmap(file);
    const longest = Math.max(bitmap.width, bitmap.height);

    if (longest <= MAX_SIDE) {
      bitmap.close();
      return { ok: true, blob: file, ext };
    }

    const scale = MAX_SIDE / longest;
    const canvas = document.createElement('canvas');

    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));

    const context = canvas.getContext('2d');

    if (!context) {
      bitmap.close();
      return { ok: true, blob: file, ext };
    }

    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', QUALITY);
    });

    if (
      encoded &&
      encoded.type === 'image/webp' &&
      encoded.size > 0 &&
      encoded.size <= MAX_BYTES
    ) {
      return { ok: true, blob: encoded, ext: 'webp' };
    }

    return { ok: true, blob: file, ext };
  } catch {
    // 캔버스를 못 쓰는 환경(구형 브라우저 등)에서는 원본 그대로
    return { ok: true, blob: file, ext };
  }
}
