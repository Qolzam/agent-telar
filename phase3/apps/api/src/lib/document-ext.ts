import path from 'path';

/** Prefer the upload original name when Multer stores an extensionless temp path. */
export function resolveDocumentExt(source: string, filenameHint?: string): string {
  return path.extname(filenameHint || source).toLowerCase();
}
