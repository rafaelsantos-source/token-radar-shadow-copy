// Shadow Copy Radar — a copy-trading model for token-radar-01.
//
// The question is not "which protocol is biggest" but "which pre-token
// protocol would a copy-trader follow, and with how much?" Every signal
// comes from the sealed snapshot's own figures; no protocol name is ever
// special-cased, and the same function scores every row.
//
// A protocol's copy score blends five signals, each 0..1:
//   inflow        — the 7-day TVL flow: wallets are arriving or leaving
//   scale         — log TVL: a mirror needs enough depth to enter and exit
//   breadth       — chain count: more chains, more distinct wallet cohorts
//   persistence   — age: a protocol that survived is likelier to launch
//   category_heat — the median 7-day flow of its category's pre-token peers
// copy_score = 0.30*inflow + 0.20*scale + 0.15*breadth + 0.15*persistence
//              + 0.20*category_heat
// implied_value_usd = tvl_usd x 0.22 x (0.35 + 1.6 x copy_score)
//
// The board covers the whole rankable universe: every watchlist protocol
// plus every rankable pre-token protocol below the watchlist floor. No
// TVL cutoff beyond rankability — the early radar exists to find the
// small ones early, and a copy-trader sizes by tier instead of excluding.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  copy_floor: number;
  copy_range: number;
  weight_inflow: number;
  weight_scale: number;
  weight_breadth: number;
  weight_persistence: number;
  weight_category_heat: number;
  flow_floor: number;
  flow_cap: number;
  unknown_flow: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.22,
  copy_floor: 0.35,
  copy_range: 1.6,
  weight_inflow: 0.3,
  weight_scale: 0.2,
  weight_breadth: 0.15,
  weight_persistence: 0.15,
  weight_category_heat: 0.2,
  // Calibrated to the sealed snapshot's flow regime (median 7-day flow
  // about -8%, 90th percentile about +1%): a wide window would compress
  // every inflow into one number. Tiers likewise: A is the top slice.
  flow_floor: -30,
  flow_cap: 60,
  unknown_flow: 0.45,
  unknown_age_days: 365,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'shadow-copy-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    copy_score: number;
    inflow: number;
    scale: number;
    breadth: number;
    persistence: number;
    category_heat: number;
    copy_multiplier: number;
    tier: string;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the copy plan generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  copy_score: number;
  inflow: number;
  scale: number;
  breadth: number;
  persistence: number;
  category_heat: number;
  tier: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  watchlist_slugs: Record<string, boolean>;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A 7-day flow in per cent, normalised to 0..1; null flow reads as the unknown-flow value. */
export function inflowSignal(change7d: number | null, model: ModelConstants): number {
  if (change7d === null || !Number.isFinite(change7d)) return model.unknown_flow;
  return (clamp(change7d, model.flow_floor, model.flow_cap) - model.flow_floor) / (model.flow_cap - model.flow_floor);
}

/** Log-scale depth: $5M maps to 0, $100B maps to 1. */
export function scaleSignal(tvlUsd: number): number {
  const lo = Math.log10(5_000_000);
  const hi = Math.log10(100_000_000_000);
  return clamp((Math.log10(Math.max(1, tvlUsd)) - lo) / (hi - lo), 0, 1);
}

/** Chain breadth: one chain is a single cohort, five or more is the whole field. */
export function breadthSignal(chains: string[]): number {
  const n = chains.length;
  if (n <= 0) return 0.1;
  if (n === 1) return 0.25;
  if (n === 2) return 0.45;
  if (n === 3) return 0.65;
  if (n === 4) return 0.8;
  return 1;
}

/** Persistence: a protocol that survived is likelier to launch than a new one. */
export function persistenceSignal(age: number | null): number {
  if (age === null) return 0.5;
  if (age < 90) return 0.3;
  if (age < 180) return 0.45;
  if (age < 365) return 0.6;
  if (age < 730) return 0.78;
  if (age < 1095) return 0.9;
  return 1;
}

/** The five signals and the copy score for one protocol. */
export interface CopySignals {
  inflow: number;
  scale: number;
  breadth: number;
  persistence: number;
  categoryHeat: number;
  score: number;
  copyMult: number;
  age: number | null;
}

export function copySignals(
  protocol: SnapshotProtocol,
  asOf: string,
  categoryHeat: number,
  model: ModelConstants,
): CopySignals {
  const age = ageDays(asOf, protocol.listed_at);
  const inflow = inflowSignal(protocol.change_7d, model);
  const scale = scaleSignal(protocol.tvl_usd);
  const breadth = breadthSignal(protocol.chains);
  const persistence = persistenceSignal(age);
  const score =
    model.weight_inflow * inflow +
    model.weight_scale * scale +
    model.weight_breadth * breadth +
    model.weight_persistence * persistence +
    model.weight_category_heat * categoryHeat;
  const copyMult = model.copy_floor + model.copy_range * score;
  return { inflow, scale, breadth, persistence, categoryHeat, score, copyMult, age };
}

/** The copy tier a score buys: A mirrors full size, B half, C a probe. */
export function tierOf(score: number): string {
  if (score >= 0.5) return 'A';
  if (score >= 0.38) return 'B';
  return 'C';
}

/** Mirror size in dollars for a tier. */
export function mirrorUsdFor(tier: string): number {
  if (tier === 'A') return 250;
  if (tier === 'B') return 150;
  return 75;
}

/** How many mirrors at this tier may run at once. */
export function maxMirrorsFor(tier: string): number {
  if (tier === 'A') return 6;
  if (tier === 'B') return 4;
  return 2;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Median of a sorted number list, or null when empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Category heat: the median 7-day flow of the category's rankable pre-token
 * peers, normalised like inflow. A category with fewer than three reporting
 * peers reads as neutral — one loud protocol must not heat a whole category.
 */
export function categoryHeats(snapshot: Snapshot, model: ModelConstants): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    if (p.change_7d === null || !Number.isFinite(p.change_7d)) continue;
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key) ?? [];
    list.push(p.change_7d);
    byCategory.set(key, list);
  }
  const heats = new Map<string, number>();
  for (const [key, values] of byCategory) {
    const med = median(values);
    if (med === null || values.length < 3) {
      heats.set(key, 0.5);
    } else {
      heats.set(key, (clamp(med, model.flow_floor, model.flow_cap) - model.flow_floor) / (model.flow_cap - model.flow_floor));
    }
  }
  return heats;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const heats = categoryHeats(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the floor, not
  // a capped sample — a copy-trader sizes by tier instead of excluding.
  const early = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const heat = heats.get(p.category ?? 'Uncategorised') ?? 0.5;
    const sig = copySignals(p, snapshot.as_of, heat, model);
    const implied = Math.max(1, Math.round(p.tvl_usd * model.base_multiple * sig.copyMult));
    return { p, sig, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.sig.age,
    implied_value_usd: s.implied,
    model: {
      copy_score: round4(s.sig.score),
      inflow: round4(s.sig.inflow),
      scale: round4(s.sig.scale),
      breadth: round4(s.sig.breadth),
      persistence: round4(s.sig.persistence),
      category_heat: round4(s.sig.categoryHeat),
      copy_multiplier: round4(s.sig.copyMult),
      tier: tierOf(s.sig.score),
      age_days: s.sig.age,
    },
    farm_steps: farmSteps(s.p, s.sig).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The mirror action for a category, in the words a copy-trader can follow. */
function mirrorActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Mirror the cohort on ${name}: supply $${capital} of USDC to its lending pool on ${chain} and keep the position open, the same action the wallets you are copying took.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Mirror the cohort on ${name}: provide $${capital} of liquidity to its main pool on ${chain} and keep the position open, the same action the wallets you are copying took.`;
  if (c.includes('bridge')) return `Mirror the cohort on ${name}: bridge $${capital} of USDC to ${chain} through it and use the bridged funds in its app, the same action the wallets you are copying took.`;
  if (c.includes('staking') || c.includes('restak')) return `Mirror the cohort on ${name}: stake $${capital} of the chain's staking asset through it and keep the receipt, the same action the wallets you are copying took.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Mirror the cohort on ${name}: deposit $${capital} of USDC as margin and open one small hedge, the same action the wallets you are copying took.`;
  if (c.includes('prediction')) return `Mirror the cohort on ${name}: fund $${capital} and place one market position, the same action the wallets you are copying took.`;
  if (c.includes('curator') || c.includes('allocator')) return `Mirror the cohort on ${name}: deposit $${capital} into one of its vaults on ${chain} and keep the shares, the same action the wallets you are copying took.`;
  if (c.includes('stable')) return `Mirror the cohort on ${name}: mint or deposit $${capital} of the stable asset through it on ${chain}, the same action the wallets you are copying took.`;
  if (c.includes('rwa')) return `Mirror the cohort on ${name}: mint $${capital} of its yield asset on ${chain} and hold it, the same action the wallets you are copying took.`;
  if (c.includes('insurance')) return `Mirror the cohort on ${name}: buy $${capital} of cover from it on ${chain} and keep the policy, the same action the wallets you are copying took.`;
  return `Mirror the cohort on ${name}: deposit $${capital} of USDC into it on ${chain} and keep the position open, the same action the wallets you are copying took.`;
}

/** The flow trigger for a protocol's 7-day TVL move, in plain words. */
function flowTriggerFor(p: SnapshotProtocol, capital: number): string {
  const flow = p.change_7d;
  if (flow === null || !Number.isFinite(flow)) {
    return `The snapshot records no 7-day flow for ${p.name}, so mirror a half-size $${Math.round(capital / 2)} first and add the rest only after a week of positive flow.`;
  }
  if (flow > 0) {
    return `${p.name} gained ${flow}% of TVL in 7 days: add to the mirror only while the weekly flow stays positive, and pause new deposits the week it turns negative.`;
  }
  if (flow < 0) {
    return `${p.name} lost ${Math.abs(flow)}% of TVL in 7 days: mirror a half-size $${Math.round(capital / 2)} now and wait for two positive weeks before adding more.`;
  }
  return `${p.name} is flat over 7 days: mirror a half-size $${Math.round(capital / 2)} and add the rest only once the flow turns positive.`;
}

/** A dollar amount with thousands separators, for plan text. */
function fmtInt(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * A protocol's copy plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains,
 * TVL, age, 7-day flow, copy score), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, sig: CopySignals): FarmStep[] {
  const chain = chainOf(p);
  const tier = tierOf(sig.score);
  const capital = mirrorUsdFor(tier);
  const hold = holdDaysFor(sig.age);
  const maxPos = maxMirrorsFor(tier);
  const tvlHalf = Math.round(p.tvl_usd / 2);
  return [
    {
      text: `Open a fresh copy wallet that holds only the funds you plan to mirror with, and keep its seed phrase offline. Never reuse a wallet that holds other positions.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: mirrorActionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 250 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: flowTriggerFor(p, capital),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Copy score ${sig.score.toFixed(2)} puts ${p.name} in tier ${tier}: mirror $${capital} per position and run at most ${maxPos} mirrors at this tier at once, so one bad copy cannot sink the book.`,
      cost: `$${capital} of capital per mirror`,
      time: '5 minutes to size',
    },
    {
      text: `Hold the mirror for at least ${hold} days so the activity is counted in more than one snapshot, and unwind if the 7-day flow stays negative for two weeks running or TVL falls below $${fmtInt(tvlHalf)}.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Write the wallet, the dates and every transaction in a copy log, and claim only from the link the protocol's own points page publishes. Never pay anyone to claim for you.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the copy plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    copy_score: row.model.copy_score,
    inflow: row.model.inflow,
    scale: row.model.scale,
    breadth: row.model.breadth,
    persistence: row.model.persistence,
    category_heat: row.model.category_heat,
    tier: row.model.tier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    watchlist_slugs: Object.fromEntries(snapshot.watchlist.map((s) => [s, true])),
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
