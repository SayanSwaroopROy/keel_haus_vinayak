"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useState, type ReactNode } from "react";
import { isApiError } from "@/lib/api/errors";
import { RoleHandover } from "@/components/motion/role-handover";
import { RouteTransition } from "@/components/motion/route-transition";
import { Toaster } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const NO_RETRY_CODES = new Set(["unauthorized", "forbidden", "not_found", "validation_error", "bad_response"]);

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => !(isApiError(error) && NO_RETRY_CODES.has(error.code)) && failureCount < 2,
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <Toaster>{children}</Toaster>
        <Suspense fallback={null}>
          <RoleHandover />
        </Suspense>
        <Suspense fallback={null}>
          <RouteTransition />
        </Suspense>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
