import type { InputType, Lang } from '@/lib/api/schemas';

export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function clock(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function figure(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export const INPUT_LABEL: Record<InputType, string> = {
  voice: 'Voice note',
  image: 'Photo',
  pdf: 'PDF',
  csv: 'CSV',
  xlsx: 'Spreadsheet',
  docx: 'Document',
  txt: 'Text file',
  text: 'Typed text',
};

export const LANG_LABEL: Record<Lang, { name: string; script: string }> = {
  bn: { name: 'Bengali', script: 'বাংলা' },
  hi: { name: 'Hindi', script: 'हिन्दी' },
  en: { name: 'English', script: 'English' },
};
