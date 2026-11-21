import Image from "next/image";
import { cn } from "cn";
import type { Trilingual } from "@/lib/i18n/labels";

export function VinayakLogo({ className, priority }: { className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/vinayak-logo.webp"
      alt="Vinayak, Soch Apnepan Ki"
      width={308}
      height={79}
      priority={priority}
      className={cn("h-auto w-36", className)}
    />
  );
}

/** English first; Bengali and Hindi as a quieter second line. */
export function Trilabel({ label, className, subClassName }: { label: Trilingual; className?: string; subClassName?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col leading-tight", className)}>
      <span className="truncate">{label.en}</span>
      <span className={cn("truncate text-[0.72rem] font-normal opacity-75", subClassName)}>
        <span lang="bn">{label.bn}</span>
        <span aria-hidden="true"> · </span>
        <span lang="hi">{label.hi}</span>
      </span>
    </span>
  );
}
