"use server";

import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { CostingError } from "@/lib/costing";
import { queryOne } from "@/lib/db";
import {
  extractRfq,
  makeAnthropicExtractor,
  parseCsv,
  type ExtractedRfq,
} from "@/lib/extract";
import {
  addPart,
  addRate,
  createRfq,
  decideQuote,
  DomainError,
  loadRates,
  recordOutcome,
  savePartAndCosting,
  searchPast,
  sendQuote,
  submitQuote,
  today,
  type NewPart,
} from "@/lib/services";
import {
  endSession,
  ForbiddenError,
  requireRole,
  requireUser,
  startSession,
} from "@/lib/session";

export interface ActionState {
  error?: string;
  issues?: string[];
  ok?: string;
}

/** Turn expected failures into messages for the form; let unexpected ones reach the error boundary. */
async function guard(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? {};
  } catch (e) {
    if (e instanceof CostingError) return { error: "The numbers do not add up yet", issues: e.issues };
    if (e instanceof z.ZodError)
      return {
        error: "Some values are not valid",
        issues: e.issues.map((i) => `${i.path.join(".") || "value"}: ${i.message}`),
      };
    if (e instanceof DomainError || e instanceof ForbiddenError) return { error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // Next.js redirect / not-found
    console.error(e);
    throw e;
  }
}

// ---------- sign in ----------

const attempts = new Map<string, { n: number; first: number }>();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8.nG8Xk6c5Zb6n2cX3p3pQ6mH3x7W2";

export async function loginAction(_: ActionState, form: FormData): Promise<ActionState> {
  const parsed = z
    .object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password" };
  const { email, password } = parsed.data;

  const now = Date.now();
  const rec = attempts.get(email);
  if (rec && now - rec.first < WINDOW_MS && rec.n >= MAX_ATTEMPTS)
    return { error: "Too many attempts. Try again in a few minutes." };

  const user = await queryOne<{ id: number; password_hash: string }>(
    "select id, password_hash from users where email = $1",
    [email],
  );
  // Always run a hash comparison so a missing account takes as long as a wrong password.
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok) {
    attempts.set(email, rec && now - rec.first < WINDOW_MS ? { n: rec.n + 1, first: rec.first } : { n: 1, first: now });
    return { error: "Email or password is not right" };
  }
  attempts.delete(email);
  await startSession(user.id);
  redirect("/rfqs");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}

// ---------- intake ----------

export interface ExtractState extends ActionState {
  extracted?: ExtractedRfq;
  email?: string;
  fileName?: string;
}

async function readSheet(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  if (file.size > 2 * 1024 * 1024) throw new DomainError("The file is larger than 2 MB");
  const buf = Buffer.from(await file.arrayBuffer());
  if (name.endsWith(".csv")) return parseCsv(buf.toString("utf8")).slice(0, 500);
  if (name.endsWith(".xlsx")) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new DomainError("The workbook has no sheets");
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= 500) return;
      const values = (row.values as unknown[]).slice(1, 31);
      rows.push(
        values.map((v) => {
          if (v == null) return "";
          if (typeof v === "object") {
            const o = v as { text?: unknown; result?: unknown };
            return String(o.text ?? o.result ?? "");
          }
          return String(v);
        }),
      );
    });
    return rows;
  }
  throw new DomainError("Upload a .xlsx or .csv file");
}

export async function extractAction(_: ExtractState, form: FormData): Promise<ExtractState> {
  await requireUser();
  const email = String(form.get("email") ?? "");
  const titleBlock = String(form.get("titleBlock") ?? "");
  if (email.length > 20000 || titleBlock.length > 5000) return { error: "That text is too long to read", email };
  const file = form.get("sheet");
  try {
    let rows: string[][] | undefined;
    let fileName: string | undefined;
    if (file instanceof File && file.size > 0) {
      rows = await readSheet(file);
      fileName = file.name;
    }
    if (!email.trim() && !rows && !titleBlock.trim())
      return { error: "Paste the RFQ email, or upload the part list, or both." };
    const rates = await loadRates();
    const materials = [...new Set(rates.filter((r) => r.kind === "material" && !r.code.endsWith("-SCRAP")).map((r) => r.code))];
    const key = process.env.ANTHROPIC_API_KEY;
    const extracted = await extractRfq({
      email,
      titleBlock,
      rows,
      knownMaterials: materials,
      today: await today(),
      llm: key ? makeAnthropicExtractor(key) : undefined,
    });
    return { extracted, email, fileName };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message, email };
    throw e;
  }
}

const sourceSchema = z.object({
  source: z.string().max(300),
  accepted: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
});

const opSchema = z.object({
  workCentreCode: z.string().trim().min(1).max(40),
  cycleMin: z.number().min(0).max(10000),
  setupMin: z.number().min(0).max(100000),
  suggestedFrom: z.string().max(200).nullish(),
});

const partSchema = z.object({
  name: z.string().trim().min(1).max(120),
  materialCode: z.string().trim().min(1).max(40),
  grossWtKg: z.number().positive().max(5000),
  netWtKg: z.number().positive().max(5000),
  annualVolume: z.number().int().positive().max(100_000_000),
  toolingCost: z.number().min(0).max(1e9).default(0),
  packingPerUnit: z.number().min(0).max(1e6).default(0),
  marginPct: z.number().min(0).lt(60).default(12),
  volumes: z.array(z.number().int().positive()).max(3).optional(),
  sources: z.record(z.string(), sourceSchema).optional(),
  acceptedKeys: z.array(z.string()).max(20).optional(),
  ops: z.array(opSchema).max(30).default([]),
});

const createSchema = z.object({
  customer: z.string().trim().min(1).max(120),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceText: z.string().max(20000).optional(),
  via: z.enum(["manual", "intake"]).default("manual"),
  parts: z.array(partSchema).min(1).max(50),
});

export async function createRfqAction(payload: string): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    const input = createSchema.parse(JSON.parse(payload));
    if (input.dueOn < (await today())) throw new DomainError("The due date is in the past");
    const parts: NewPart[] = [];
    for (const p of input.parts) {
      const part: NewPart = { ...p, sources: { ...(p.sources ?? {}) } };
      // Suggest a routing from the most similar past part when the estimator gave none.
      if (part.ops!.length === 0) {
        const [best] = await searchPast({
          similarTo: { name: p.name, materialCode: p.materialCode, grossWtKg: p.grossWtKg },
          limit: 1,
        });
        if (best && (best.score ?? 0) >= 0.6 && best.routing.length > 0) {
          const from = `${best.quote_ref} ${best.part_name} (${best.customer}), similarity ${best.score}`;
          part.ops = best.routing.map((o) => ({
            workCentreCode: o.workCentreCode,
            cycleMin: o.cycleMin,
            setupMin: o.setupMin,
            suggestedFrom: from,
          }));
          part.sources!.routing = { source: `suggested from past part ${from}`, accepted: false, confidence: best.score };
        }
      }
      parts.push(part);
    }
    const id = await createRfq(user.id, {
      customer: input.customer,
      dueOn: input.dueOn,
      sourceText: input.sourceText,
      via: input.via,
      parts,
    });
    revalidatePath("/rfqs");
    redirect(`/rfqs/${id}`);
  });
}

// ---------- parts and costing ----------

export async function savePartCostingAction(partId: number, payload: string): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    const p = partSchema.extend({ ops: z.array(opSchema).min(1).max(30) }).parse(JSON.parse(payload));
    const hasSuggested = p.ops.some((o) => o.suggestedFrom);
    if (hasSuggested && !(p.acceptedKeys ?? []).includes("routing"))
      throw new DomainError("Accept the suggested routing, or edit it, before saving");
    await savePartAndCosting(user.id, partId, p);
    revalidatePath("/rfqs", "layout");
    return { ok: "Costing saved" };
  });
}

export async function addPartAction(rfqId: number, _: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    const p = z
      .object({
        name: z.string().trim().min(1).max(120),
        materialCode: z.string().trim().min(1).max(40),
        grossWtKg: z.coerce.number().positive().max(5000),
        netWtKg: z.coerce.number().positive().max(5000),
        annualVolume: z.coerce.number().int().positive().max(100_000_000),
      })
      .refine((v) => v.netWtKg <= v.grossWtKg, { message: "Net weight cannot exceed gross weight", path: ["netWtKg"] })
      .parse(Object.fromEntries(form));
    await addPart(user.id, rfqId, p);
    revalidatePath(`/rfqs/${rfqId}`);
    return { ok: "Part added" };
  });
}

// ---------- quotes ----------

export async function submitQuoteAction(rfqId: number): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    await submitQuote(user.id, rfqId);
    revalidatePath("/", "layout");
    return { ok: "Quote submitted" };
  });
}

export async function decideQuoteAction(
  quoteId: number,
  decision: "approve" | "reject",
  note: string,
): Promise<ActionState> {
  return guard(async () => {
    const user = await requireRole("sales_head");
    await decideQuote(user.id, quoteId, decision, z.string().max(500).parse(note));
    revalidatePath("/", "layout");
    return { ok: decision === "approve" ? "Quote approved" : "Quote sent back" };
  });
}

export async function sendQuoteAction(quoteId: number): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    await sendQuote(user.id, quoteId);
    revalidatePath("/", "layout");
    return { ok: "Quote marked as sent" };
  });
}

export async function outcomeAction(
  rfqId: number,
  outcome: "won" | "lost",
  reason: string,
): Promise<ActionState> {
  const user = await requireUser();
  return guard(async () => {
    await recordOutcome(user.id, rfqId, z.enum(["won", "lost"]).parse(outcome), z.string().max(300).parse(reason));
    revalidatePath("/", "layout");
    return { ok: "Outcome recorded" };
  });
}

// ---------- rate masters ----------

export async function addRateAction(_: ActionState, form: FormData): Promise<ActionState> {
  return guard(async () => {
    const user = await requireRole("sales_head");
    const v = z
      .object({
        kind: z.enum(["material", "work_centre", "param"]),
        code: z.string().trim().min(1).max(40),
        label: z.string().trim().min(1).max(120),
        unit: z.string().trim().min(1).max(20),
        value: z.coerce.number().min(0).max(1e9),
        effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(Object.fromEntries(form));
    await addRate(user.id, v);
    revalidatePath("/rates");
    return { ok: "Rate added" };
  });
}
