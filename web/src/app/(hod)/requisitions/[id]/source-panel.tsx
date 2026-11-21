"use client";

import { FileAudioIcon, FileImageIcon, FileTextIcon } from "lucide-react";
import { useEffect, useMemo } from "react";
import { DummyBadge, QueryState } from "@/components/ledger";
import { useFile } from "@/lib/api/hooks";
import { isMocked } from "@/lib/api/mode";
import type { Requisition } from "@/lib/api/schemas";
import { LANG_NAMES } from "@/lib/i18n/labels";
import { INPUT_TYPE_LABEL } from "@/lib/requisition";

function useObjectUrl(blob: Blob | null | undefined): string | null {
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function Viewer({ blob, label }: { blob: Blob; label: string }) {
  const url = useObjectUrl(blob);
  if (!url) return null;
  if (blob.type.startsWith("audio/")) return <audio controls src={url} className="w-full max-w-xl" aria-label={label} />;
  if (blob.type.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- authorised blob URL, not optimisable by next/image
    return <img src={url} alt={label} className="max-h-[70vh] w-auto rounded-md border border-rule" />;
  }
  if (blob.type === "application/pdf") return <iframe src={url} title={label} className="h-[70vh] w-full rounded-md border border-rule" />;
  return (
    <a href={url} download className="text-sm text-binding underline">
      Download the original file
    </a>
  );
}

const ICON = { voice: FileAudioIcon, image: FileImageIcon } as const;

export function SourcePanel({ requisition }: { requisition: Requisition }) {
  const query = useFile(requisition.source_file_id);
  const label = `${INPUT_TYPE_LABEL[requisition.input_type]} in ${LANG_NAMES[requisition.original_lang]}`;
  const Icon = requisition.input_type === "voice" || requisition.input_type === "image" ? ICON[requisition.input_type] : FileTextIcon;

  if (requisition.source_file_id === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Raised as pasted text, so there is no file. The extracted lines are the record.
      </p>
    );
  }

  if (isMocked("files.get")) {
    return (
      <div className="flex max-w-xl flex-col gap-3 rounded-md border border-dashed border-rule p-5">
        <div className="flex items-center gap-3">
          <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
          <span className="font-medium">{label}</span>
          <DummyBadge>Simulated</DummyBadge>
        </div>
        <p className="text-sm text-muted-foreground">
          The original file plays here once file serving is live. The engineer&apos;s exact words stay unchanged; every line in this
          requisition points back to where it came from.
        </p>
      </div>
    );
  }

  return (
    <QueryState query={query}>
      <div className="flex flex-col gap-3">
        <span className="text-sm font-medium">{label}</span>
        {query.data ? <Viewer blob={query.data} label={label} /> : null}
      </div>
    </QueryState>
  );
}
