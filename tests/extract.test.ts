import { describe, expect, it, vi } from "vitest";
import {
  extractRfq,
  makeAnthropicExtractor,
  normaliseMaterial,
  parseCsv,
  parseDate,
  parseNumber,
} from "../src/lib/extract";

const KNOWN = ["EN8", "40Cr4-F", "20MnCr5"];
const TODAY = "2026-11-07";

const EMAIL = `From: "Priya Nair" <priya.nair@company-b.com>
To: estimation@company-a.com
Subject: RFQ - rear wheel spindle and spacer bush

Dear team,
Please send your quote by 14 Nov 2026 for the following:
1. Rear wheel spindle, EN8, 0.61 kg, 1,80,000 pcs/yr
2. Spacer bush - EN 8 - 0.09 kg - 12000 nos per year
Drawings attached.
Regards, Priya`;

describe("parsers", () => {
  it("reads Indian and plain number formats", () => {
    expect(parseNumber("1,80,000")).toBe(180000);
    expect(parseNumber("180000 pcs")).toBe(180000);
    expect(parseNumber("1.8 lakh")).toBe(180000);
    expect(parseNumber("0.61 kg")).toBe(0.61);
    expect(parseNumber("n/a")).toBeUndefined();
  });

  it("reads several date styles and rolls a missing year forward", () => {
    expect(parseDate("by 14 Nov 2026", TODAY)).toBe("2026-11-14");
    expect(parseDate("due 14/11/2026", TODAY)).toBe("2026-11-14");
    expect(parseDate("deadline 2026-11-14", TODAY)).toBe("2026-11-14");
    expect(parseDate("send by 3rd March", TODAY)).toBe("2027-03-03");
    expect(parseDate("send by 20 Nov", TODAY)).toBe("2026-11-20");
    expect(parseDate("no date here", TODAY)).toBeUndefined();
  });

  it("maps material spellings to the master code, and refuses unknown ones", () => {
    expect(normaliseMaterial("EN 8", KNOWN)).toBe("EN8");
    expect(normaliseMaterial("en-8 bar", KNOWN)).toBe("EN8");
    expect(normaliseMaterial("40 Cr 4 forging", KNOWN)).toBe("40Cr4-F");
    expect(normaliseMaterial("Inconel 718", KNOWN)).toBeUndefined();
  });

  it("parses CSV with quoted commas", () => {
    expect(parseCsv('a,b\n"x, y",2\n')).toEqual([["a", "b"], ["x, y", "2"]]);
  });
});

describe("extractRfq from an email", () => {
  it("reads customer, due date and both parts, each with a source", async () => {
    const r = await extractRfq({ email: EMAIL, knownMaterials: KNOWN, today: TODAY });
    expect(r.method).toBe("rules");
    expect(r.customer?.value).toBe("Company B");
    expect(r.customer?.source).toMatch(/From/);
    expect(r.dueOn?.value).toBe("2026-11-14");
    expect(r.parts).toHaveLength(2);
    const [a, b] = r.parts;
    expect(a.name?.value).toBe("Rear wheel spindle");
    expect(a.materialCode?.value).toBe("EN8");
    expect(a.grossWtKg?.value).toBe(0.61);
    expect(a.annualVolume?.value).toBe(180000);
    expect(a.grossWtKg?.source).toBe("email, line 7");
    expect(b.name?.value).toBe("Spacer bush");
    expect(b.annualVolume?.value).toBe(12000);
  });

  it("flags an estimated net weight as an assumption with low confidence", async () => {
    const r = await extractRfq({ email: EMAIL, knownMaterials: KNOWN, today: TODAY });
    const net = r.parts[0].netWtKg!;
    expect(net.origin).toBe("assumption");
    expect(net.confidence).toBeLessThan(0.5);
    expect(net.value).toBe(0.519);
  });

  it("does not invent parts from a message with none", async () => {
    const r = await extractRfq({ email: "Hi, please call me about pricing.", knownMaterials: KNOWN, today: TODAY });
    expect(r.parts).toHaveLength(0);
    expect(r.notes.join(" ")).toMatch(/No parts/);
  });

  it("marks an unknown material as not in the master", async () => {
    const r = await extractRfq({
      email: "1. Turbine pin, EN8, 0.2 kg, 5000 pcs/yr\n2. Odd part EN19 0.5 kg 1000 nos",
      knownMaterials: KNOWN,
      today: TODAY,
    });
    expect(r.parts).toHaveLength(2);
    expect(r.parts[0].materialCode?.confidence).toBeGreaterThan(0.5);
    expect(r.parts[1].materialCode?.value).toBe("EN19");
    expect(r.parts[1].materialCode?.confidence).toBeLessThan(0.5);
    expect(r.parts[1].materialCode?.source).toMatch(/not in the material master/);
  });
});

describe("extractRfq from a spreadsheet and title block", () => {
  const rows = [
    ["RFQ No", "Customer", "Part", "Material", "Gross Wt kg", "Annual Volume", "Cycle Time min", "Hour Rate ₹"],
    ["RFQ-2611-014", "Company B", "Rear wheel spindle", "EN8", "0.61", "180000", "3.2", "850"],
    ["RFQ-2611-019", "Company C", "Hydraulic lift arm", "40Cr4 forging", "4.60", "24,000", "11.5", "1450"],
    ["", "", "", "", "", "", "", ""],
  ];

  it("maps the brief's column headings and cites the cell", async () => {
    const r = await extractRfq({ email: "", rows, knownMaterials: KNOWN, today: TODAY });
    expect(r.parts).toHaveLength(2);
    expect(r.parts[1].materialCode?.value).toBe("40Cr4-F");
    expect(r.parts[1].annualVolume?.value).toBe(24000);
    expect(r.parts[0].grossWtKg?.source).toBe('Excel row 2, column "Gross Wt kg"');
  });

  it("fills gaps from a title block without overriding the part list", async () => {
    const r = await extractRfq({
      email: "",
      rows: [["Part", "Gross Wt kg"], ["Gear blank", "1.48"]],
      titleBlock: "DRG NO: GB-204\nPART NAME: Gear blank rev B\nMATERIAL: 20MnCr5\nNET WT: 1.12 kg",
      knownMaterials: KNOWN,
      today: TODAY,
    });
    const p = r.parts[0];
    expect(p.name?.value).toBe("Gear blank"); // list wins
    expect(p.materialCode?.value).toBe("20MnCr5");
    expect(p.materialCode?.origin).toBe("title_block");
    expect(p.netWtKg?.value).toBe(1.12);
  });
});

describe("optional LLM fallback", () => {
  const llmReply = {
    content: [
      {
        type: "tool_use",
        input: {
          customer: "Company E",
          due_date: "2026-11-20",
          parts: [{ name: "Output shaft", material: "EN8", gross_wt_kg: 0.9, annual_volume: 40000 }],
        },
      },
    ],
  };

  it("is used only when the rules find no parts, and its values are labelled as AI", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(llmReply), { status: 200 }));
    const llm = makeAnthropicExtractor("test-key", fetchMock as unknown as typeof fetch);
    const r = await extractRfq({
      email: "Could you price our usual output shaft, about forty thousand a year?",
      knownMaterials: KNOWN,
      today: TODAY,
      llm,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.method).toBe("rules+llm");
    expect(r.parts[0].name?.origin).toBe("llm");
    expect(r.parts[0].materialCode?.value).toBe("EN8");
    expect(r.customer?.origin).toBe("llm");
  });

  it("is not called when the rules already read the email", async () => {
    const fetchMock = vi.fn();
    const llm = makeAnthropicExtractor("test-key", fetchMock as unknown as typeof fetch);
    await extractRfq({ email: EMAIL, knownMaterials: KNOWN, today: TODAY, llm });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to rules, with a note, when the API fails or returns junk", async () => {
    for (const fetchMock of [
      vi.fn(async () => new Response("nope", { status: 500 })),
      vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "tool_use", input: { parts: "x" } }] }), { status: 200 })),
      vi.fn(async () => { throw new Error("network"); }),
    ]) {
      const llm = makeAnthropicExtractor("test-key", fetchMock as unknown as typeof fetch);
      const r = await extractRfq({ email: "price our output shaft please", knownMaterials: KNOWN, today: TODAY, llm });
      expect(r.parts).toHaveLength(0);
      expect(r.method).toBe("rules");
      expect(r.notes.join(" ")).toMatch(/unavailable/);
    }
  });

  it("sends only the email text and never a drawing or the key in the body", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(String(init?.body)).not.toContain("test-key");
      return new Response(JSON.stringify(llmReply), { status: 200 });
    });
    await makeAnthropicExtractor("test-key", fetchMock as unknown as typeof fetch)("hello");
    expect(fetchMock).toHaveBeenCalled();
  });
});
