import type { Metadata } from "next";
import { VinayakLogo } from "@/components/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section
        aria-label="About this workspace"
        className="relative hidden flex-col justify-between overflow-hidden bg-binding p-10 text-binding-foreground lg:flex"
      >
        <p aria-hidden="true" className="flex flex-col leading-none">
          <span className="text-[1.35rem] font-medium tracking-[0.22em]">VINAYAK</span>
          <span className="mt-1 text-[0.62rem] tracking-[0.18em] text-binding-foreground/80">PROCUREMENT · HOD</span>
        </p>
        <div className="flex max-w-md flex-col gap-5">
          <h1 className="text-4xl leading-tight font-medium text-balance">
            Every requisition settled by a person, with the evidence in front of them.
          </h1>
          <p className="text-base text-binding-foreground/85">
            The agent reads the voice notes, scans and BOQs. It flags what it is unsure of. You decide.
          </p>
        </div>
        <p lang="bn" className="text-sm text-binding-foreground/80">
          ক্রয় ব্যবস্থাপনা · <span lang="hi">क्रय प्रबंधन</span>
        </p>
        <span aria-hidden="true" className="absolute inset-y-0 right-6 w-px bg-binding-foreground/25" />
      </section>

      <section className="flex flex-col items-center justify-center gap-10 px-4 py-12 sm:px-10">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex flex-col gap-4">
            <VinayakLogo priority className="w-40" />
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-medium">Sign in to Procurement</h2>
              <p className="text-sm text-muted-foreground">HOD workspace. Use the account your administrator gave you.</p>
            </div>
          </div>
          <LoginForm />
        </div>
      </section>
    </main>
  );
}
