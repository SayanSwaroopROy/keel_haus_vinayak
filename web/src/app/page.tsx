"use client";

import { motion } from "motion/react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCounter } from "@/lib/store";

export default function Home() {
  const { count, inc } = useCounter();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6">
      <motion.h1
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 text-2xl font-semibold"
      >
        <Sparkles aria-hidden /> Stack OK
      </motion.h1>
      <Button onClick={inc}>Clicked {count}</Button>
    </main>
  );
}
