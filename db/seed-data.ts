/**
 * Seed data. The three sample RFQ lines come straight from the brief (customer, part, material,
 * gross weight, annual volume, cycle time, hour rate). Everything else here is an ASSUMPTION made
 * so the app has realistic numbers; each is labelled in the TDD.
 */

export const RATE_DATE = "2026-04-01";

export interface SeedRate {
  kind: "material" | "work_centre" | "param";
  code: string;
  label: string;
  unit: string;
  value: number;
  from?: string;
}

export const RATES: SeedRate[] = [
  // Materials, rupees per kg (assumed market rates)
  { kind: "material", code: "EN8", label: "EN8 round bar", unit: "₹/kg", value: 72 },
  { kind: "material", code: "EN8-SCRAP", label: "EN8 scrap recovery", unit: "₹/kg", value: 30 },
  { kind: "material", code: "EN8", label: "EN8 round bar (earlier)", unit: "₹/kg", value: 69, from: "2026-01-01" },
  { kind: "material", code: "EN8", label: "EN8 round bar (announced revision)", unit: "₹/kg", value: 76, from: "2026-12-01" },
  { kind: "material", code: "40Cr4-F", label: "40Cr4 forged blank", unit: "₹/kg", value: 98 },
  { kind: "material", code: "40Cr4-F-SCRAP", label: "40Cr4 flash scrap recovery", unit: "₹/kg", value: 32 },
  { kind: "material", code: "20MnCr5", label: "20MnCr5 bar", unit: "₹/kg", value: 88 },
  { kind: "material", code: "20MnCr5-SCRAP", label: "20MnCr5 scrap recovery", unit: "₹/kg", value: 31 },
  // Machine hour rates, rupees per hour. TURN-STD, HMC and TURN-HV match the brief's sample rows.
  { kind: "work_centre", code: "TURN-STD", label: "CNC turning, standard", unit: "₹/h", value: 850 },
  { kind: "work_centre", code: "TURN-HV", label: "CNC turning, heavy", unit: "₹/h", value: 950 },
  { kind: "work_centre", code: "HMC", label: "Horizontal machining centre", unit: "₹/h", value: 1450 },
  { kind: "work_centre", code: "DRILL-TAP", label: "Drilling and tapping", unit: "₹/h", value: 600 },
  { kind: "work_centre", code: "THREAD-ROLL", label: "Thread rolling", unit: "₹/h", value: 700 },
  { kind: "work_centre", code: "GRIND-CYL", label: "Cylindrical grinding", unit: "₹/h", value: 900 },
  { kind: "work_centre", code: "INSPECT", label: "Final inspection", unit: "₹/h", value: 450 },
  // Commercial parameters (assumed)
  { kind: "param", code: "OVERHEAD_PCT", label: "Overhead on conversion cost", unit: "%", value: 15 },
  { kind: "param", code: "FREIGHT_PER_KG", label: "Freight per kg of gross weight", unit: "₹/kg", value: 3.5 },
  { kind: "param", code: "GST_PCT", label: "GST on components", unit: "%", value: 18 },
  { kind: "param", code: "LOT_MONTHS", label: "Production lot, months of demand", unit: "months", value: 1 },
  { kind: "param", code: "TOOLING_YEARS", label: "Tooling amortised over", unit: "years", value: 3 },
  { kind: "param", code: "APPROVAL_THRESHOLD", label: "Sales head approval above annual value", unit: "₹", value: 2500000 },
];

export interface SeedOp {
  workCentreCode: string;
  cycleMin: number;
  setupMin: number;
}

export interface SeedPart {
  name: string;
  materialCode: string;
  grossWtKg: number;
  netWtKg: number;
  annualVolume: number;
  toolingCost: number;
  packingPerUnit: number;
  ops: SeedOp[];
}

export interface SeedRfq {
  rfqNo: string;
  customer: string;
  receivedDaysAgo: number;
  dueInDays: number;
  owner: "estimator" | "estimator2";
  parts: SeedPart[];
}

// Open RFQs. Cycle times and hour rates of the first operation of each part are the brief's samples.
export const OPEN_RFQS: SeedRfq[] = [
  {
    rfqNo: "RFQ-2611-014",
    customer: "Company B (two-wheelers)",
    receivedDaysAgo: 3,
    dueInDays: 4,
    owner: "estimator",
    parts: [
      {
        name: "Rear wheel spindle",
        materialCode: "EN8",
        grossWtKg: 0.61,
        netWtKg: 0.52,
        annualVolume: 180000,
        toolingCost: 0,
        packingPerUnit: 1.8,
        ops: [
          { workCentreCode: "TURN-STD", cycleMin: 3.2, setupMin: 45 },
          { workCentreCode: "THREAD-ROLL", cycleMin: 0.9, setupMin: 30 },
          { workCentreCode: "INSPECT", cycleMin: 0.4, setupMin: 0 },
        ],
      },
    ],
  },
  {
    rfqNo: "RFQ-2611-019",
    customer: "Company C (tractors)",
    receivedDaysAgo: 2,
    dueInDays: 6,
    owner: "estimator2",
    parts: [
      {
        name: "Hydraulic lift arm",
        materialCode: "40Cr4-F",
        grossWtKg: 4.6,
        netWtKg: 3.85,
        annualVolume: 24000,
        toolingCost: 850000,
        packingPerUnit: 8,
        ops: [
          { workCentreCode: "HMC", cycleMin: 11.5, setupMin: 90 },
          { workCentreCode: "DRILL-TAP", cycleMin: 2.2, setupMin: 20 },
          { workCentreCode: "INSPECT", cycleMin: 0.8, setupMin: 0 },
        ],
      },
    ],
  },
  {
    rfqNo: "RFQ-2611-023",
    customer: "Company D (drivetrains)",
    receivedDaysAgo: 1,
    dueInDays: 7,
    owner: "estimator",
    parts: [
      {
        name: "Gear blank",
        materialCode: "20MnCr5",
        grossWtKg: 1.48,
        netWtKg: 1.12,
        annualVolume: 60000,
        toolingCost: 0,
        packingPerUnit: 3.2,
        ops: [
          { workCentreCode: "TURN-HV", cycleMin: 4.8, setupMin: 40 },
          { workCentreCode: "INSPECT", cycleMin: 0.3, setupMin: 0 },
        ],
      },
    ],
  },
  {
    // Small order: stays under the approval threshold so the estimator can send it directly.
    rfqNo: "RFQ-2611-027",
    customer: "Company B (two-wheelers)",
    receivedDaysAgo: 1,
    dueInDays: 5,
    owner: "estimator2",
    parts: [
      {
        name: "Spacer bush",
        materialCode: "EN8",
        grossWtKg: 0.09,
        netWtKg: 0.07,
        annualVolume: 12000,
        toolingCost: 0,
        packingPerUnit: 0.6,
        ops: [
          { workCentreCode: "TURN-STD", cycleMin: 0.8, setupMin: 20 },
          { workCentreCode: "INSPECT", cycleMin: 0.15, setupMin: 0 },
        ],
      },
    ],
  },
];

// Past parts, used for similar-part search and routing suggestions.
export interface PastFamily {
  names: string[];
  material: string;
  wt: [number, number];
  volume: [number, number];
  routing: SeedOp[];
}

export const PAST_FAMILIES: PastFamily[] = [
  {
    names: ["Rear wheel spindle", "Front axle spindle", "Stub shaft", "Output shaft", "Clutch shaft"],
    material: "EN8",
    wt: [0.4, 1.2],
    volume: [60000, 220000],
    routing: [
      { workCentreCode: "TURN-STD", cycleMin: 3.0, setupMin: 45 },
      { workCentreCode: "THREAD-ROLL", cycleMin: 0.9, setupMin: 30 },
      { workCentreCode: "INSPECT", cycleMin: 0.4, setupMin: 0 },
    ],
  },
  {
    names: ["Hydraulic lift arm", "Lift link arm", "Steering arm", "Rocker arm", "Fork yoke"],
    material: "40Cr4-F",
    wt: [2.5, 6.5],
    volume: [12000, 40000],
    routing: [
      { workCentreCode: "HMC", cycleMin: 10.5, setupMin: 90 },
      { workCentreCode: "DRILL-TAP", cycleMin: 2.0, setupMin: 20 },
      { workCentreCode: "INSPECT", cycleMin: 0.8, setupMin: 0 },
    ],
  },
  {
    names: ["Gear blank", "Pinion blank", "Ring gear blank", "Sprocket blank", "Hub gear blank"],
    material: "20MnCr5",
    wt: [0.9, 2.6],
    volume: [30000, 90000],
    routing: [
      { workCentreCode: "TURN-HV", cycleMin: 4.5, setupMin: 40 },
      { workCentreCode: "INSPECT", cycleMin: 0.3, setupMin: 0 },
    ],
  },
  {
    names: ["Spacer bush", "Flanged bush", "Wheel spacer", "Collar", "Sleeve"],
    material: "EN8",
    wt: [0.05, 0.3],
    volume: [8000, 40000],
    routing: [
      { workCentreCode: "TURN-STD", cycleMin: 0.9, setupMin: 20 },
      { workCentreCode: "INSPECT", cycleMin: 0.15, setupMin: 0 },
    ],
  },
];

export const PAST_CUSTOMERS = [
  "Company B (two-wheelers)",
  "Company C (tractors)",
  "Company D (drivetrains)",
  "Company E (Tier-1)",
  "Company F (two-wheelers)",
];
