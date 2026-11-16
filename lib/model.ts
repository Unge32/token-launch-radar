// Token Radar: comparables-calibrated implied value for pre-token protocols.
//
// The board ranks protocols that record no token, by what their token would be
// worth if the protocol's record stayed as it is. The value is not a prediction
// of a launch; it is a claim derived only from the snapshot's own figures:
//
//   multiple   = median (market cap / TVL) of live-token protocols in the same
//                category (at least 3 comparables, else the global median;
//                0.5 when there is no live market to read at all)
//   maturity   = 0.7 + 0.3 * min(1, age_years / 3)   (age from listed_at to the
//                snapshot's as_of; a protocol with no listed date scores 0.7)
//   growth     = 1 + 0.5 * clip(change_7d / 100, -0.5, 1.0)
//   breadth    = 1 + 0.05 * min(chains, 5)
//   implied    = TVL x multiple x maturity x growth x breadth,
//                floored at $1,000,000 and capped at $100,000,000,000
//
// The watchlist (the snapshot's own list) is the floor: all 40 of its slugs are
// ranked, plus the 160 pre-token protocols below the floor with the most TVL.
// Live-token protocols are never ranked; they are the comparables the model
// reads, and the dashboard shows them in a panel of their own. No protocol
// name is ever special-cased: one function scores every row.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
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

/** The model's constants; the dashboard prints them next to the formula. */
export interface ModelConstants {
  fallback_multiple: number;
  min_comps: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_years: number;
  growth_weight: number;
  growth_clip_low: number;
  growth_clip_high: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  implied_floor_usd: number;
  implied_cap_usd: number;
}

export const MODEL: ModelConstants = {
  fallback_multiple: 0.5,
  min_comps: 3,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_years: 3,
  growth_weight: 0.5,
  growth_clip_low: -0.5,
  growth_clip_high: 1.0,
  breadth_per_chain: 0.05,
  breadth_max_chains: 5,
  implied_floor_usd: 1_000_000,
  implied_cap_usd: 100_000_000_000,
};

/** This model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-2';

/** Pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** Live-token protocols the dashboard's comparables panel lists, by market cap. */
export const LIVE_TOP = 12;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: string;
    maturity: number;
    growth: number;
    breadth: number;
  };
  farm_steps: string[];
}

/** One row of the dashboard's data.js, with the farm plan and the model's working. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: string;
  maturity: number;
  growth: number;
  breadth: number;
  watchlist: boolean;
  farm_steps: string[];
}

/** One live-token protocol shown as a comparable, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** One category's live market: the median multiple and how many protocols set it. */
export interface Comparable {
  category: string;
  median_multiple: number;
  comps: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  comparables: Comparable[];
  global_multiple: number;
  rows: RadarRow[];
  live_top: LiveRow[];
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

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers; NaN when the list is empty. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A live-token protocol the model can read a multiple from. */
export function isLive(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The bucket a protocol's comparables come from; null category reads as Uncategorized. */
export function bucketOf(p: SnapshotProtocol): string {
  return p.category ?? 'Uncategorized';
}

/**
 * The live market's multiples: one median per category, plus the global median.
 * A category with fewer than `min_comps` protocols falls back to the global median.
 */
export interface Multiples {
  byCategory: Map<string, { median: number; comps: number }>;
  global: number;
}

export function computeMultiples(snapshot: Snapshot, model: ModelConstants): Multiples {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isLive(p)) continue;
    const m = (p.mcap_usd as number) / p.tvl_usd;
    if (!Number.isFinite(m) || m <= 0) continue;
    all.push(m);
    const bucket = bucketOf(p);
    const list = perCategory.get(bucket);
    if (list) list.push(m);
    else perCategory.set(bucket, [m]);
  }
  const global = median(all);
  const byCategory = new Map<string, { median: number; comps: number }>();
  for (const [bucket, values] of [...perCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    byCategory.set(bucket, { median: median(values), comps: values.length });
  }
  return { byCategory, global: Number.isFinite(global) ? global : model.fallback_multiple };
}

/** Which multiple a protocol is scored on, and where it came from. */
export function multipleFor(p: SnapshotProtocol, multiples: Multiples, model: ModelConstants): { multiple: number; source: string } {
  const entry = multiples.byCategory.get(bucketOf(p));
  if (entry !== undefined && entry.comps >= model.min_comps) {
    return { multiple: entry.median, source: `${bucketOf(p)} median (${entry.comps} live)` };
  }
  if (Number.isFinite(multiples.global) && multiples.global > 0) {
    return { multiple: multiples.global, source: 'global median' };
  }
  return { multiple: model.fallback_multiple, source: 'fallback 0.5' };
}

/** The four factors and the implied value one protocol gets. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  multiples: Multiples,
  model: ModelConstants,
): { raw: number; implied: number; multiple: number; source: string; maturity: number; growth: number; breadth: number; age: number | null } {
  const { multiple: multipleFull, source } = multipleFor(p, multiples, model);
  const age = ageDays(asOf, p.listed_at);
  // Each factor is rounded to four decimals BEFORE the product, because the
  // board stores the rounded factors and the dashboard recomputes the value
  // from them: rounding here is what makes the two agree exactly.
  const multiple = round4(multipleFull);
  const maturity = round4(
    age === null
      ? model.maturity_floor
      : model.maturity_floor + model.maturity_range * Math.min(1, age / (model.maturity_years * 365)),
  );
  const change = finite(p.change_7d, 0) / 100;
  const clipped = Math.min(model.growth_clip_high, Math.max(model.growth_clip_low, change));
  const growth = round4(1 + model.growth_weight * clipped);
  const breadth = round4(1 + model.breadth_per_chain * Math.min(p.chains.length, model.breadth_max_chains));
  const raw = p.tvl_usd * multiple * maturity * growth * breadth;
  const implied = Math.max(
    model.implied_floor_usd,
    Math.min(model.implied_cap_usd, Math.round(raw)),
  );
  return { raw, implied, multiple, source, maturity, growth, breadth, age };
}

/** Round to four decimals for display. */
export function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** One farm step as a single string: the action, then its cost and time. */
function stepText(action: string, cost: string, time: string): string {
  let s = `${action} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  return 75;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 90;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of the chain's main asset against it and repay the loan in the same week`;
  }
  if (c.includes('dex') || c.includes('amm')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} — half USDC, half the pool's other asset — and keep the position in range`;
  }
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('basis trad')) {
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and keep the vault shares`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside the app it points to`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('dor')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one $25 hedge, closing it before the week ends`;
  }
  if (c.includes('prediction')) {
    return `Fund your ${name} account with $${capital} on ${chain} and place one $25 position on a market that settles within a month`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the protocol's own savings vault`;
  }
  if (c.includes('rwa') || c.includes('tokenized')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in the wallet you farm with`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active`;
  }
  if (c.includes('launchpad')) {
    return `Commit $${capital} of USDC to the next ${name} sale on ${chain} and claim any allocation the sale returns`;
  }
  if (c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it through one monthly rebalance`;
  }
  if (c.includes('ai agent') || c.includes('decentralized ai')) {
    return `Spend $${capital} of USDC running one of ${name}'s agent services on ${chain} and keep the receipts`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares until the vault's next epoch`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open`;
}

/** The category's weekly qualifying action, a second touchpoint from the first. */
function weeklyAction(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $20 against the supply on ${name} and repay it the same week, so the week counts as active borrowing`;
  }
  if (c.includes('dex') || c.includes('amm')) {
    return `Swap $25 through ${name}'s main pool on ${chain} and collect the trading fees the position earns`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge $25 through ${name} to a second chain and back, keeping the receipt of each crossing`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Claim the staking rewards ${name} pays on ${chain} and restake them instead of selling`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('dor')) {
    return `Open and close one $25 hedge on ${name} on ${chain}, keeping the position size small and the margin untouched`;
  }
  if (c.includes('prediction')) {
    return `Place one $10 position on a new ${name} market each week and let the settled ones close on their own`;
  }
  if (c.includes('stable')) {
    return `Move $25 of the stable asset through ${name}'s savings vault on ${chain} and back, so the vault sees weekly flow`;
  }
  return `Make one small qualifying action on ${name} — a deposit, a swap, a vote or a claim — so the week counts as active`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const steps: string[] = [
    stepText(
      `Open a fresh wallet for farming ${p.name} on ${chain}, fund it with $${capital} of USDC plus about $10 for gas, and keep the seed phrase offline`,
      'about $10 of gas to fund and set up',
      '10 minutes',
    ),
    stepText(
      coreAction(p, capital, chain),
      `$${capital} of capital and about $${capital >= 250 ? 8 : 4} of gas`,
      '15 minutes to set up',
    ),
    stepText(
      weeklyAction(p, chain),
      'about $2 of gas a week',
      '10 minutes a week',
    ),
    stepText(
      `Hold the position for at least ${hold} days so the activity is counted across more than one points snapshot`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ),
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    const small = Math.max(25, Math.round(capital / 4));
    steps.push(
      stepText(
        `Repeat the core position on ${second} with $${small} of USDC, so the farm covers two of ${p.name}'s ${p.chains.length} chains instead of one`,
        `$${small} of capital and about $4 of gas`,
        '15 minutes',
      ),
    );
  } else {
    steps.push(
      stepText(
        `Open ${p.name}'s own points or rewards page once a week and check that the wallet's activity is showing up`,
        '$0 to check, and never pay to claim',
        '5 minutes a week',
      ),
    );
  }
  steps.push(
    stepText(
      `Before you withdraw, claim only from the link ${p.name} itself publishes, and write the wallet, the dates and every transaction in a farm log`,
      '$0 to check, and never pay to claim',
      '10 minutes',
    ),
  );
  return steps;
}

/** The live-token protocols, by market cap, for the comparables panel. */
export function liveTopRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isLive(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_TOP)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
      multiple: round4((p.mcap_usd as number) / p.tvl_usd),
    }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const multiples = computeMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  // Rank by the raw value, then floor/cap the number the board carries.
  scored.sort((a, b) => b.v.raw - a.v.raw || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: round4(s.v.multiple),
      multiple_source: s.v.source,
      maturity: round4(s.v.maturity),
      growth: round4(s.v.growth),
      breadth: round4(s.v.breadth),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = computeMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const comparables: Comparable[] = [...multiples.byCategory.entries()]
    .map(([category, entry]) => ({ category, median_multiple: round4(entry.median), comps: entry.comps }))
    .sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watchlist.has(r.slug)).length,
    comparables,
    global_multiple: round4(multiples.global),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      multiple_source: r.model.multiple_source,
      maturity: r.model.maturity,
      growth: r.model.growth,
      breadth: r.model.breadth,
      watchlist: watchlist.has(r.slug),
      farm_steps: r.farm_steps,
    })),
    live_top: liveTopRows(snapshot),
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
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
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: window.RADAR, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
