import type { InputType } from '@/lib/api/schemas';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'text/csv',
  'text/comma-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
];

const BY_EXTENSION: Record<string, InputType> = {
  pdf: 'pdf',
  csv: 'csv',
  xlsx: 'xlsx',
  docx: 'docx',
  txt: 'txt',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  heic: 'image',
  m4a: 'voice',
  mp3: 'voice',
  wav: 'voice',
  aac: 'voice',
  ogg: 'voice',
  webm: 'voice',
};

export function inputTypeFor(name: string, mimeType: string | undefined): InputType | null {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  const byExtension = BY_EXTENSION[extension];
  if (byExtension) return byExtension;
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('audio/')) return 'voice';
  return null;
}
