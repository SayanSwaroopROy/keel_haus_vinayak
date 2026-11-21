"use client";

import { ArrowLeftIcon, SendIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { QueryState } from "@/components/ledger";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { describeError } from "@/lib/api/errors";
import { useConversations, useMessages, useRfqs, useSendMessage } from "@/lib/api/hooks-flow";
import type { Conversation, Message, Rfq } from "@/lib/api/schemas-flow";
import { formatRelative, reqNumber } from "@/lib/format";

function ListItem({ conversation, rfq, active }: { conversation: Conversation; rfq: Rfq | undefined; active: boolean }) {
  return (
    <li>
      <Link
        href={`/conversations?c=${conversation.id}`}
        aria-current={active ? "true" : undefined}
        className={cn("flex min-h-16 items-start gap-3 px-4 py-3 transition-colors hover:bg-ledger focus-visible:bg-ledger lg:px-3", active && "bg-ledger")}
      >
        <span aria-hidden="true" className={cn("mt-2 size-2 shrink-0 rounded-full", conversation.unread > 0 ? "bg-binding" : "bg-transparent")} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className={cn("truncate text-sm", conversation.unread > 0 ? "font-medium" : "")}>{conversation.vendor_name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(conversation.last_activity)}</span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {rfq?.category ?? "RFQ"} · {reqNumber(conversation.requisition_id)}
          </span>
          <span className="truncate text-sm text-muted-foreground">{conversation.last_message ?? "No messages yet"}</span>
        </span>
        {conversation.unread > 0 ? <span className="sr-only">{conversation.unread} unread</span> : null}
      </Link>
    </li>
  );
}

function Bubble({ message, itemName }: { message: Message; itemName: string | null }) {
  if (message.type === "system") {
    return <li className="py-1 text-center text-xs text-muted-foreground">{message.text}</li>;
  }
  const mine = message.sender_role === "hod";
  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      {itemName ? <span className="text-xs text-muted-foreground">About: {itemName}</span> : null}
      <p className={cn("max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap", mine ? "bg-accent text-accent-foreground" : "border border-rule")}>
        {message.type === "voice" ? <span className="block text-xs text-muted-foreground">Voice message, transcribed</span> : null}
        {message.text ?? message.transcript}
      </p>
      <span className="text-xs text-muted-foreground tabular-nums">{formatRelative(message.created_at)}</span>
    </li>
  );
}

function Thread({ conversation, rfq }: { conversation: Conversation; rfq: Rfq | undefined }) {
  const messages = useMessages(conversation.id);
  const send = useSendMessage(conversation.id);
  const [text, setText] = useState("");
  const [itemId, setItemId] = useState("");
  const endRef = useRef<HTMLLIElement>(null);
  const count = messages.data?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === "" || send.isPending) return;
    send.mutate(
      { text: trimmed, rfqItemId: itemId || null },
      {
        onSuccess: () => setText(""),
        onError: (error) => toast.add({ title: "Message not sent", description: describeError(error), type: "error" }),
      },
    );
  };

  return (
    <section aria-label={`Chat with ${conversation.vendor_name}`} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-rule px-4 py-3 lg:px-5">
        <Link href="/conversations" aria-label="Back to conversations" className="-ml-2 grid size-11 place-items-center text-muted-foreground hover:text-foreground lg:hidden">
          <ArrowLeftIcon aria-hidden="true" className="size-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-medium">{conversation.vendor_name}</h2>
          <p className="truncate text-xs text-muted-foreground">
            {rfq ? (
              <Link href={`/rfqs/${rfq.id}`} className="underline underline-offset-4 hover:text-foreground">
                {rfq.category} RFQ
              </Link>
            ) : (
              "RFQ"
            )}{" "}
            · {reqNumber(conversation.requisition_id)}
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-5" aria-live="polite">
        <QueryState query={messages} isEmpty={count === 0} empty={{ title: "No messages yet", description: "Write to the vendor below." }}>
          <ul className="flex flex-col gap-3">
            {messages.data?.map((message) => (
              <Bubble key={message.id} message={message} itemName={rfq?.items.find((item) => item.id === message.rfq_item_id)?.description ?? null} />
            ))}
            <li ref={endRef} aria-hidden="true" />
          </ul>
        </QueryState>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-col gap-2 border-t border-rule bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-5"
      >
        {rfq && rfq.items.length > 0 ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            About
            <select value={itemId} onChange={(event) => setItemId(event.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground">
              <option value="">Whole RFQ</option>
              {rfq.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="flex items-end gap-2">
          <Textarea
            value={text}
            rows={2}
            aria-label={`Message to ${conversation.vendor_name}`}
            placeholder="Write to the vendor"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="min-h-11 flex-1 resize-none"
          />
          <Button type="submit" size="lg" className="h-11" disabled={text.trim() === "" || send.isPending}>
            {send.isPending ? <Spinner data-icon="inline-start" /> : <SendIcon data-icon="inline-start" />}
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}

export function ConversationCentre() {
  const router = useRouter();
  const params = useSearchParams();
  const conversations = useConversations();
  const rfqs = useRfqs();
  const rows = conversations.data ?? [];

  const selectedId = params.get("c");
  const deepRfq = params.get("rfq");
  const deepVendor = params.get("vendor");
  const fromDeepLink = deepRfq && deepVendor ? rows.find((row) => row.rfq_id === deepRfq && row.vendor_id === deepVendor) : undefined;
  const selected = rows.find((row) => row.id === selectedId) ?? fromDeepLink;

  useEffect(() => {
    if (fromDeepLink && !selectedId) router.replace(`/conversations?c=${fromDeepLink.id}`);
  }, [fromDeepLink, selectedId, router]);

  const rfqOf = (conversation: Conversation) => rfqs.data?.find((row) => row.id === conversation.rfq_id);

  return (
    <div className="grid min-h-0 flex-1 lg:h-[calc(100dvh-10.5rem)] lg:grid-cols-[22rem_minmax(0,1fr)] lg:border lg:border-rule">
      <div className={cn("min-h-0 overflow-y-auto lg:border-r lg:border-rule", selected && "hidden lg:block")}>
        <QueryState
          query={conversations}
          isEmpty={rows.length === 0}
          empty={{ title: "No conversations yet", description: "A thread opens for each vendor when you send an RFQ." }}
        >
          <ul className="flex flex-col divide-y divide-rule border-b border-rule lg:border-b-0">
            {rows.map((conversation) => (
              <ListItem key={conversation.id} conversation={conversation} rfq={rfqOf(conversation)} active={conversation.id === selected?.id} />
            ))}
          </ul>
        </QueryState>
      </div>
      <div className={cn("flex min-h-0 flex-col", !selected && "hidden lg:flex")}>
        {selected ? (
          <Thread key={selected.id} conversation={selected} rfq={rfqOf(selected)} />
        ) : (
          <p className="m-auto max-w-xs px-6 text-center text-sm text-muted-foreground">Pick a conversation to read it. Chats are tied to an RFQ and, where it matters, to a single line.</p>
        )}
      </div>
    </div>
  );
}
