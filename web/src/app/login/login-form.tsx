"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api/endpoints";
import { describeError, isApiError } from "@/lib/api/errors";
import { LoginInputSchema, type LoginInput } from "@/lib/api/schemas";
import { useSession } from "@/lib/auth/session";

export function LoginForm() {
  const router = useRouter();
  const signIn = useSession((state) => state.signIn);
  const [wrongRole, setWrongRole] = useState(false);
  const form = useForm<LoginInput>({ resolver: zodResolver(LoginInputSchema), defaultValues: { username: "", password: "" } });

  const login = useMutation({
    mutationFn: api.login,
    onSuccess: ({ token, user }) => {
      if (user.role !== "hod") {
        setWrongRole(true);
        return;
      }
      signIn({ token, user });
      router.replace("/");
    },
  });

  const submit = form.handleSubmit((values) => {
    setWrongRole(false);
    login.mutate(values);
  });

  const errorText =
    login.error && isApiError(login.error) && login.error.code === "unauthorized"
      ? "That username and password don't match. Check both and try again."
      : login.error
        ? describeError(login.error)
        : null;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      {errorText ? (
        <Alert variant="destructive" aria-live="polite">
          <AlertTitle>Couldn&apos;t sign in</AlertTitle>
          <AlertDescription>{errorText}</AlertDescription>
        </Alert>
      ) : null}
      {wrongRole ? (
        <Alert aria-live="polite">
          <AlertTitle>This workspace is for the HOD</AlertTitle>
          <AlertDescription>Site engineers and vendors use the Vinayak mobile app.</AlertDescription>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field data-invalid={form.formState.errors.username ? true : undefined}>
          <FieldLabel htmlFor="username">Username</FieldLabel>
          <Input
            id="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={form.formState.errors.username ? true : undefined}
            className="h-10"
            {...form.register("username")}
          />
          <FieldError errors={[form.formState.errors.username]} />
        </Field>
        <Field data-invalid={form.formState.errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={form.formState.errors.password ? true : undefined}
            className="h-10"
            {...form.register("password")}
          />
          <FieldError errors={[form.formState.errors.password]} />
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" className="h-10" disabled={login.isPending}>
        {login.isPending ? <Spinner data-icon="inline-start" /> : null}
        {login.isPending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
