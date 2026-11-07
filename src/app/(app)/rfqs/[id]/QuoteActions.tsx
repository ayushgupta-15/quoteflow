"use client";

import { useState, useTransition } from "react";
import {
  decideQuoteAction,
  outcomeAction,
  sendQuoteAction,
  submitQuoteAction,
  type ActionState,
} from "@/app/actions";

function Feedback({ r }: { r: ActionState }) {
  if (r.error)
    return (
      <div className="notice bad" role="alert" style={{ marginTop: 12 }}>
        {r.error}
        {r.issues ? (
          <ul>
            {r.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  return null;
}

export function SubmitQuoteButton({ rfqId, disabled, label }: { rfqId: number; disabled: boolean; label: string }) {
  const [r, setR] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <>
      <button
        className="btn primary"
        disabled={disabled || pending}
        onClick={() => start(async () => setR(await submitQuoteAction(rfqId)))}
      >
        {pending ? "Submitting…" : label}
      </button>
      <Feedback r={r} />
    </>
  );
}

export function DecideButtons({ quoteId }: { quoteId: number }) {
  const [note, setNote] = useState("");
  const [r, setR] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const run = (d: "approve" | "reject") => start(async () => setR(await decideQuoteAction(quoteId, d, note)));
  return (
    <div>
      <div className="field">
        <label htmlFor={`note-${quoteId}`}>Note (required to send back)</label>
        <input id={`note-${quoteId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </div>
      <div className="row">
        <button className="btn primary" disabled={pending} onClick={() => run("approve")}>
          Approve
        </button>
        <button className="btn danger" disabled={pending} onClick={() => run("reject")}>
          Send back
        </button>
      </div>
      <Feedback r={r} />
    </div>
  );
}

export function SendButton({ quoteId }: { quoteId: number }) {
  const [r, setR] = useState<ActionState>({});
  const [pending, start] = useTransition();
  return (
    <>
      <button className="btn primary" disabled={pending} onClick={() => start(async () => setR(await sendQuoteAction(quoteId)))}>
        {pending ? "Sending…" : "Mark as sent"}
      </button>
      <Feedback r={r} />
    </>
  );
}

export function OutcomeButtons({ rfqId }: { rfqId: number }) {
  const [reason, setReason] = useState("");
  const [r, setR] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const run = (o: "won" | "lost") => start(async () => setR(await outcomeAction(rfqId, o, reason)));
  return (
    <div>
      <div className="field">
        <label htmlFor="lost-reason">Reason (required if lost)</label>
        <input id="lost-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. price 6% above competitor" />
      </div>
      <div className="row">
        <button className="btn" disabled={pending} onClick={() => run("won")}>
          Mark won
        </button>
        <button className="btn danger" disabled={pending} onClick={() => run("lost")}>
          Mark lost
        </button>
      </div>
      <Feedback r={r} />
    </div>
  );
}
