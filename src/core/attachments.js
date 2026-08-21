/**
 * attachments.js: Word/PDF/photo receipts, attach-only.
 *
 * AceBudget never auto-reads amounts or dates out of a PDF, Word document,
 * or photo: parsing those reliably needs libraries this project doesn't
 * carry, and a silently-wrong extracted number is a real risk in a finance
 * tool. Instead, these files are attached to a transaction as a reference:
 * the user still types the amount, and can open the original later. See
 * the import/export policy in docs/GAP-ANALYSIS.md.
 *
 * Excel is different: a spreadsheet is already structured data, so it's
 * genuinely parsed. See `xlsx.js` for that path.
 */

/** localStorage has ~5-10MB per origin; keep any single attachment well under it. */
export const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;

const KIND_BY_MIME = {
  'application/pdf': 'pdf',
  'application/msword': 'word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'word',
  'image/jpeg': 'photo', 'image/png': 'photo', 'image/webp': 'photo', 'image/heic': 'photo', 'image/heif': 'photo',
};

/** Classify a File by MIME type, falling back to its extension. */
export function attachmentKind(file) {
  if (KIND_BY_MIME[file.type]) return KIND_BY_MIME[file.type];
  if (file.type.startsWith('image/')) return 'photo';
  if (/\.pdf$/i.test(file.name)) return 'pdf';
  if (/\.docx?$/i.test(file.name)) return 'word';
  return null;
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
}

/** Downscale and re-compress a photo client-side: phone photos are far too large to store as-is. */
function compressImage(file, maxDim = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo.')); };
    img.src = url;
  });
}

/**
 * Turn a user-picked file into a storable attachment record: `{name, kind,
 * type, dataUrl, size}`. Photos are recompressed; PDFs/Word docs are kept
 * as-is under a size cap so they don't blow the local-storage budget.
 * @param {File} file
 * @returns {Promise<{ok:boolean, attachment?:object, error?:string}>}
 */
export async function attachFile(file) {
  const kind = attachmentKind(file);
  if (!kind) return { ok: false, error: 'Attachments must be a PDF, Word document (.docx), or photo.' };

  if (kind === 'photo') {
    try {
      const dataUrl = await compressImage(file);
      return { ok: true, attachment: { name: file.name, kind, type: 'image/jpeg', dataUrl, size: dataUrl.length } };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not process that photo.' };
    }
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    const mb = (n) => (n / (1024 * 1024)).toFixed(1);
    return { ok: false, error: `That file is ${mb(file.size)}MB. Attachments are capped at ${mb(MAX_ATTACHMENT_BYTES)}MB so everything still fits in this browser's local storage.` };
  }
  try {
    const dataUrl = await readAsDataURL(file);
    return { ok: true, attachment: { name: file.name, kind, type: file.type, dataUrl, size: file.size } };
  } catch (err) {
    return { ok: false, error: err.message || 'Could not read that file.' };
  }
}
