// The token radar's model, version 2: one snapshot of the protocol universe in,
// one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a
// ceiling) and adds pre-token protocols below the watchlist floor: the early rows
// the radar exists to find. A protocol is pre-token when its index entry records
// no token (no market cap, no CoinGecko id, no symbol); the snapshot's
// live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, calibrated at
// runtime from the live-token protocols inside the same snapshot:
//
//   category multiple = median mcap/TVL of live-token protocols in the category
//                         (TVL > 0, mcap > 0, CEX excluded), shrunk toward the
//                         global median for small categories:
//                         mult = (n * catMedian + 3 * globalMedian) / (n + 3)
//                         clamped to [0.03, 1.2]. Categories with no live
//                         protocols use the global median.
//   growth     = clamp(change_7d, -50, 150) per cent
//   growthMult = 1 + (growth / 100) * 0.4
//   maturity   = 0.7 + min(age_days, 1095) / 1095 * 0.3   (age unknown: 365 days)
//   chainMult  = 1 + 0.04 * min(chains - 1, 5), capped at 1.2
//   implied    = max(1, round(tvl * categoryMultiple * growthMult
//                              * maturityMult * chainMult))
//
// Nothing about a protocol's name is ever special-cased: the same functions
// score every row, and every number above is derived from the snapshot at
// runtime. No constant in this file carries a calibrated median.

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

/**
 * The model's constants. The weights, clamps and the shrinkage prior are the
 * model's design choices; the multiples themselves are NOT constants: they are
 * filled in at runtime by calibrateModel() from the snapshot being scored.
 * `global_multiple` is 0 and `category_multiples` is empty until calibration
 * runs, which is how the board knows a model has not been calibrated yet.
 */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_extra_max: number;
  chain_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_prior: number;
  global_multiple: number;
  category_multiples: Record<string, number>;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_extra_max: 5,
  chain_cap: 1.2,
  multiple_floor: 0.03,
  multiple_cap: 1.2,
  shrink_prior: 3,
  global_multiple: 0,
  category_multiples: {},
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

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
  age_days: number;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number;
  };
  farm_steps: string[];
}

/**
 * The dashboard's compact view of one row. Unlike the house starter, this
 * carries the farm plan with it, so the page never has to regenerate plans
 * in the browser and the plan the user reads is exactly the plan the board
 * was gated on.
 */
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
  age_days: number;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  farm_steps: string[];
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

/** The age used when a protocol has no listing date: one year. */
const UNKNOWN_AGE_DAYS = 365;

/**
 * The house flat multiple, used ONLY as a last-resort fallback when
 * impliedValue is called with a model that was never calibrated (no global
 * multiple, no category multiples). The board path never touches it: buildBoard
 * always calibrates from the snapshot first. It is a documented fallback, not
 * a calibrated number.
 */
const UNCALIBRATED_FALLBACK_MULTIPLE = 0.25;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp `v` into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** The median of a non-empty list of numbers. The input is sorted in place. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round to four decimals so the board's multipliers print cleanly. */
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * Calibrate the category multiples from the snapshot's own live-token
 * protocols. A live-token protocol is one with a positive TVL and a positive
 * market cap; CEX protocols are excluded because exchange tokens are valued
 * on exchange equity, not on protocol TVL, and would poison every category
 * they touched.
 *
 * For each category, the raw signal is the median mcap/TVL of its live
 * protocols. The median is used instead of the mean because a single
 * outlier (a tiny-TVL protocol with a huge market cap) would otherwise drag
 * the whole category with it. Small categories are shrunk toward the global
 * median with a prior of `shrink_prior` pseudo-observations:
 *
 *   mult = (n * catMedian + shrink_prior * globalMedian) / (n + shrink_prior)
 *
 * so a category with one live protocol is mostly the global median, while a
 * category with fifteen live protocols mostly trusts its own median. The
 * result is clamped to [multiple_floor, multiple_cap]. Categories with no
 * live protocols at all get the global median. The returned model keeps the
 * caller's weights and only fills in the multiples.
 */
export function calibrateModel(snapshot: Snapshot, base: ModelConstants = MODEL): ModelConstants {
  const ratiosByCategory = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.category === 'CEX') continue;
    if (p.tvl_usd <= 0 || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    allRatios.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key);
    if (list === undefined) ratiosByCategory.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = allRatios.length > 0 ? median(allRatios) : UNCALIBRATED_FALLBACK_MULTIPLE;
  const multiples: Record<string, number> = {};
  // Keys in sorted order so the calibrated model serialises identically
  // no matter how the snapshot's protocols happen to be ordered.
  const categories = [...ratiosByCategory.keys()].sort();
  for (const category of categories) {
    const ratios = ratiosByCategory.get(category)!;
    const catMedian = median(ratios);
    const n = ratios.length;
    const shrunk = (n * catMedian + base.shrink_prior * globalMedian) / (n + base.shrink_prior);
    multiples[category] = round4(clamp(shrunk, base.multiple_floor, base.multiple_cap));
  }
  return {
    ...base,
    global_multiple: round4(globalMedian),
    category_multiples: multiples,
  };
}

/** The category multiple a protocol gets: its category's calibrated multiple, else the global median. */
export function categoryMultipleFor(model: ModelConstants, category: string | null): number {
  if (category !== null) {
    const m = model.category_multiples[category];
    if (typeof m === 'number' && Number.isFinite(m)) return m;
  }
  if (model.global_multiple > 0) return model.global_multiple;
  return UNCALIBRATED_FALLBACK_MULTIPLE;
}

/**
 * A whole day count from `listedAt` to `asOf`, clamped at zero. A missing or
 * unparseable listing date counts as 365 days: old enough to be real, young
 * enough not to earn the full maturity premium for free.
 */
export function ageDays(asOf: string, listedAt: string | null): number {
  if (listedAt === null) return UNKNOWN_AGE_DAYS;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return UNKNOWN_AGE_DAYS;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): {
  implied: number;
  categoryMultiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const catMult = categoryMultipleFor(model, protocol.category);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_extra_max);
  const chainMult = Math.min(1 + model.chain_step * extraChains, model.chain_cap);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * catMult * growthMult * maturityMult * chainMult),
  );
  return { implied, categoryMultiple: catMult, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule, as the snapshot README states it: a name ending in a release is a pool of another protocol. */
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

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n.
 *
 * The model is calibrated from the snapshot on every call unless the caller
 * already passed a calibrated one, so the board never depends on a number
 * baked into this file. The watchlist is the floor: every slug in it is
 * ranked. The early radar then adds pre-token protocols below the floor by
 * TVL, capped at EARLY_ROWS, never displacing a watchlist row.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const calibrated = model.global_multiple > 0 ? model : calibrateModel(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer
  // carries (it cannot, but the board's coverage is the gate's row and is
  // never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the watchlist floor, by TVL,
  // capped. A chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibrated);
    return { p, v };
  });
  scored.sort(
    (a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
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
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      category_multiple: round4(s.v.categoryMultiple),
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      chain_multiplier: round4(s.v.chainMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

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

/**
 * The native gas token of a chain, by the chain's own name as DefiLlama
 * writes it. This is chain knowledge, not a protocol list: it never names a
 * protocol, and an unlisted chain falls back to a neutral phrase.
 */
const GAS_TOKENS: Record<string, string> = {
  Ethereum: 'ETH',
  Solana: 'SOL',
  Base: 'ETH',
  Arbitrum: 'ETH',
  Optimism: 'ETH',
  'BNB Chain': 'BNB',
  BSC: 'BNB',
  Polygon: 'POL',
  Avalanche: 'AVAX',
  'zkSync Era': 'ETH',
  Linea: 'ETH',
  Scroll: 'ETH',
  Blast: 'ETH',
  Mantle: 'MNT',
  Gnosis: 'xDAI',
  Fantom: 'FTM',
  Aptos: 'APT',
  Sui: 'SUI',
  Near: 'NEAR',
  Cosmos: 'ATOM',
  Tron: 'TRX',
  Ton: 'TON',
  Berachain: 'BERA',
  Sonic: 'S',
  Hyperliquid: 'HYPE',
  Sei: 'SEI',
  Injective: 'INJ',
  Starknet: 'STRK',
  Zora: 'ETH',
  Mode: 'ETH',
  Fraxtal: 'frxETH',
  'Arbitrum Nova': 'ETH',
  'Polygon zkEVM': 'ETH',
  Celo: 'CELO',
  Kava: 'KAVA',
  Cronos: 'CRO',
  Harmony: 'ONE',
  Moonbeam: 'GLMR',
  Bitcoin: 'BTC',
  Cardano: 'ADA',
  Litecoin: 'LTC',
  Dogecoin: 'DOGE',
  'Ethereum Classic': 'ETC',
};

function gasToken(chain: string): string {
  return GAS_TOKENS[chain] ?? 'the chain\u2019s native gas token';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The farming family a category belongs to, read off the category string
 * itself. No protocol name is ever consulted: two protocols in the same
 * category farm the same way, whatever they are called. Order matters here:
 * bridge is checked before chain (a cross-chain bridge is a bridge, not a
 * chain), and staking before yield (a staking pool stakes).
 */
function familyOf(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  if (c.includes('risk curator') || c.includes('allocator')) return 'curator';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lending';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('staking') || c.includes('restak')) return 'staking';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) return 'perps';
  if (c.includes('basis')) return 'basis';
  if (c.includes('yield') || c.includes('farm')) return 'yield';
  if (c.includes('stable')) return 'stablecoin';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('payment')) return 'payments';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('governance')) return 'governance';
  if (c.trim() === 'chain') return 'chain';
  return 'default';
}

/** The category family's core action: the one thing the position is for. */
function coreAction(family: string, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Supply $${capital} of USDC to ${name} on ${chain} and borrow a small amount of a stablecoin against it, keeping the loan well below the liquidation line.`;
    case 'dex':
      return `Add $${capital} of liquidity to ${name}'s largest pool on ${chain} and keep the position open.`;
    case 'rwa':
      return `Complete ${name}'s whitelist or identity check on its own site if it asks for one, then mint $${capital} of its yield-bearing asset on ${chain} and hold it.`;
    case 'curator':
      return `Deposit $${capital} split across two ${name} vaults on ${chain} with different risk profiles, and keep both sets of shares.`;
    case 'bridge':
      return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside an app on ${chain} instead of bridging straight back.`;
    case 'staking':
      return `Stake $${capital} of the staking asset through ${name} on ${chain} and keep the receipt token in the farming wallet.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position, keeping leverage low.`;
    case 'basis':
      return `Deposit $${capital} into ${name}'s delta-neutral vault on ${chain} and keep the shares while its hedge runs.`;
    case 'yield':
      return `Deposit $${capital} into ${name}'s main vault on ${chain} and keep the shares.`;
    case 'stablecoin':
      return `Mint $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
    case 'prediction':
      return `Fund $${capital} and place one market position on ${name} on ${chain}.`;
    case 'payments':
      return `Receive $${capital} into ${name} on ${chain} and spend or send a small part of it through its payment flow.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} for a protocol you already use, and keep the policy active.`;
    case 'governance':
      return `Delegate $${capital} of voting power through ${name} on ${chain} and vote on one live proposal.`;
    case 'chain':
      return `Bridge $${capital} to ${chain} and stake or delegate it through ${name}'s own staking or validator flow, keeping the stake in the farming wallet.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
  }
}

/** The second action: different from the first, so the wallet shows more than one kind of use. */
function secondAction(family: string, p: SnapshotProtocol, capital: number, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Repay part of the borrow, then borrow again in a smaller size, so the loop shows repeated use without raising liquidation risk.`;
    case 'dex':
      return `Swap a small amount through ${name} on ${chain} and add liquidity to a second pool, so the wallet shows both LP and swap volume.`;
    case 'rwa':
      return `Hold the minted asset through one full distribution cycle, so the wallet records at least one payout from ${name}.`;
    case 'curator':
      return `Move a small share between the two ${name} vaults once the first deposit has settled, so the wallet shows activity in more than one vault.`;
    case 'bridge':
      return `Bridge a smaller amount back, or onward to a second chain, through ${name}, so the wallet shows repeat bridging instead of a single hop.`;
    case 'staking':
      return `Use the receipt token once, for example by supplying it to a lending market, without unstaking the base position in ${name}.`;
    case 'perps':
      return `Close the first position and open a second small one in the opposite direction, so the wallet shows real trading activity rather than one open trade.`;
    case 'basis':
      return `Check the hedge position once it has run for a week and record the funding it earned in the farm log.`;
    case 'yield':
      return `Claim the vault yield once it accrues and compound it back into the same ${name} vault.`;
    case 'stablecoin':
      return `Use part of the minted stable asset in a lending market or pool on ${chain}, then return it, so the wallet shows the stablecoin in use.`;
    case 'prediction':
      return `Place a second position on a different ${name} market and close the first one before it resolves.`;
    case 'payments':
      return `Make a second payment through ${name} to a different recipient, so the wallet shows repeat payment use.`;
    case 'insurance':
      return `Add cover for a second protocol, or extend the first ${name} policy before it expires.`;
    case 'governance':
      return `Vote on a second proposal and leave a short reason in the forum or vote thread if one is open.`;
    case 'chain':
      return `Use an app that runs on ${chain} with a small amount of the bridged funds, so the wallet shows activity on the chain itself.`;
    default:
      return `Use a second feature of ${name} on ${chain}, such as a swap, a vote or a claim, so the wallet shows more than one kind of activity.`;
  }
}

/** The weekly qualifying cadence, specific to the family. */
function weeklyAction(family: string, p: SnapshotProtocol, chain: string): string {
  const name = p.name;
  switch (family) {
    case 'lending':
      return `Once a week, adjust the ${name} position: top up the supply, repay a little of the borrow, or move the borrow to a different asset.`;
    case 'dex':
      return `Swap a small amount through ${name} each week and rebalance the LP position when its ratio drifts.`;
    case 'rwa':
      return `Check the distribution or yield payout from ${name} once a week and record each payout in the farm log.`;
    case 'curator':
      return `Review both ${name} vaults once a week and rebalance a small share toward the vault that fits your risk.`;
    case 'bridge':
      return `Bridge a small amount through ${name} once a week and use the funds on the destination chain each time.`;
    case 'staking':
      return `Check the staking rewards from ${name} once a week and restake the accrual or record it in the farm log.`;
    case 'perps':
      return `Place one small hedged trade a week on ${name} and close it before the week ends.`;
    case 'basis':
      return `Check the ${name} vault and its funding once a week and record the return in the farm log.`;
    case 'yield':
      return `Claim and compound the ${name} vault yield once a week.`;
    case 'stablecoin':
      return `Check the peg and the yield on the minted stable asset from ${name} once a week and record both.`;
    case 'prediction':
      return `Place one small market position a week on ${name}.`;
    case 'payments':
      return `Send or spend a small payment through ${name} once a week.`;
    case 'insurance':
      return `Check the active ${name} cover once a week and record its expiry date in the farm log.`;
    case 'governance':
      return `Check ${name} for new proposals once a week and vote on any that are live.`;
    case 'chain':
      return `Use one app on ${chain} a week and check the staking rewards from ${name}.`;
    default:
      return `Use ${name} once a week: a deposit, a swap, a vote or a claim, whichever its app offers.`;
  }
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category, first
 * chain and its gas token, TVL, age), never from a hand-written list of
 * names. Step 1 is wallet hygiene, steps 2-4 are the family's actions and
 * cadence, step 5 is the hold window, step 6 is the claim rule, step 7 is
 * the log that makes the position repeatable or unwindable.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasToken(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyOf(p.category);
  return [
    {
      text: `Open a fresh wallet used only for ${p.name} on ${chain}; fund it with a little ${gas} for gas and keep its seed phrase offline.`,
      cost: `under $5 of ${gas} for gas`,
      time: '10 minutes',
    },
    {
      text: coreAction(family, p, capital, chain),
      cost: `$${capital} of capital plus gas`,
      time: '20 minutes to set up',
    },
    {
      text: secondAction(family, p, capital, chain),
      cost: 'about $3 of gas',
      time: '15 minutes',
    },
    {
      text: weeklyAction(family, p, chain),
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one snapshot and is not a single-day spike.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page, check what you have earned, and claim only from the link that page publishes; never pay a fee to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it later.`,
      cost: 'nothing but the log',
      time: '5 minutes after each action',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    )
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

/** A board row's compact form for data.js, with the farm plan carried along. */
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
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const calibrated = model.global_multiple > 0 ? model : calibrateModel(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: calibrated,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
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
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
