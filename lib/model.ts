// Token Radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// rankable pre-token protocol below the watchlist floor: the early rows the radar exists to find. A
// protocol is pre-token when its record carries no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown with the market's own values, never
// mixed into the ranked board. Protocols above the floor that the watchlist leaves out are not ranked:
// the house's own rule left them out because they are wrapped, staked or bridged products of a token
// that already trades, or products of a parent protocol, so they are not standalone launches.
//
// Implied value follows only from the snapshot's own figures. The base multiple is not a flat number:
// it is calibrated from the live-token protocols in the same snapshot, category by category. For each
// category the model takes the median market-cap-to-TVL ratio of the live-token protocols in it, then
// shrinks that median toward the global median (empirical Bayes, prior strength 10) so a category with
// one or two live protocols does not set the multiple on its own. The multiple is clamped to
// [0.05, 1.0]. Categories with no live protocol use the global median.
//
// The shrinkage is done in log space, because market-cap-to-TVL ratios spread multiplicatively (in this
// snapshot the 25th percentile is 0.03x and the 75th is 1.0x): the geometric combination is the right
// centre for ratios, and on a leave-one-out backtest over the snapshot's own live-token protocols it
// predicts market cap better than linear shrinkage. Centralised exchanges are left out of the
// calibration: their ratios reflect exchange businesses, not DeFi protocols, and the board already
// excludes them from ranking; leaving them out improves the backtest too (median error 5.1x vs 5.4x).
// A TVL-weighted median was tested and rejected: it predicts worse (7.1x), because a few giant
// protocols dominate it.
//
//   category_multiple = clamp(exp((n_cat * ln(median_cat) + 10 * ln(median_all)) / (n_cat + 10)), 0.05, 1.0)
//   growth_mult       = 1 + clamp(change_7d, -60, 120) / 100 * 0.5
//   maturity_mult     = 0.6 + 0.4 * age_days / (age_days + 365)   (age unknown: 365 days)
//   chain_mult        = 1 + 0.02 * min(chains - 1, 10)
//   implied           = max(1, round(tvl_usd * category_multiple * growth_mult * maturity_mult * chain_mult))
//
// Maturity saturates: a protocol reaches half its maturity bonus at one year old, and the bonus flattens
// after that, because surviving the first year is the strong filter and age past three years adds little.
// Chain breadth rewards reach: a protocol live on many chains has more surface for a launch. No protocol
// name is ever special-cased: the same function scores every row, and the calibration is recomputed from
// the snapshot on every run. The model's own backtest (validateModel) is shipped in the dashboard's data,
// so the page can state how well the model predicts the live market it was calibrated on.

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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_half_life_days: number;
  unknown_age_days: number;
  chain_bonus_per_chain: number;
  chain_bonus_max_chains: number;
  prior_strength: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_half_life_days: 365,
  unknown_age_days: 365,
  chain_bonus_per_chain: 0.02,
  chain_bonus_max_chains: 10,
  prior_strength: 10,
  multiple_floor: 0.05,
  multiple_cap: 1.0,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's calibration: the live median, the sample size, and the multiple the model uses. */
export interface CategoryCalibration {
  category: string;
  live_count: number;
  live_median: number | null;
  multiple: number;
}

/** The whole calibration: the global median and every category's multiple. */
export interface Calibration {
  global_median: number;
  global_count: number;
  categories: CategoryCalibration[];
}

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
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_live_count: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
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
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  mcap_tvl_ratio: number | null;
  change_7d: number | null;
}

/**
 * The model's own backtest: leave-one-out prediction of the live-token protocols' market caps.
 * `median_factor` is the median ratio between predicted and actual market cap (1.0 would be exact);
 * `within_2x` / `within_3x` are the shares predicted within a factor of two / three. The dashboard's
 * Model view states these numbers, so the model is judged on evidence, not on its own claims.
 */
export interface Validation {
  n: number;
  median_factor: number;
  within_2x: number;
  within_3x: number;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  validation: Validation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
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

/** The median of a sorted array, or null when it is empty. */
function medianOf(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Calibrate the base multiple from the snapshot's own live-token protocols. For each category the
 * median market-cap-to-TVL ratio of its live protocols is shrunk toward the global median, so a
 * category with few live protocols does not set its multiple on thin evidence. The shrinkage is done
 * in log space: ratios spread multiplicatively, so the geometric combination is the right centre.
 * The result is clamped to the model's floor and cap. Categories with no live protocol take the
 * global median. Centralised exchanges are left out: their ratios reflect exchange businesses, not
 * DeFi protocols, and the board excludes them from ranking too. `exclude` drops one slug from the
 * calibration (the backtest's leave-one-out).
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL, exclude: string | null = null): Calibration {
  const ratios: number[] = [];
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.slug === exclude) continue;
    if (isPreToken(p) || p.mcap_usd === null || p.tvl_usd <= 0) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    ratios.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(ratio);
    byCategory.set(key, list);
  }
  ratios.sort((a, b) => a - b);
  const globalMedian = medianOf(ratios) ?? 0.25;
  const categories: CategoryCalibration[] = [];
  for (const [category, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => a - b);
    const catMedian = medianOf(list)!;
    // Geometric shrinkage: a weighted mean of the logs, back in ratio space.
    const shrunk = Math.exp((list.length * Math.log(catMedian) + model.prior_strength * Math.log(globalMedian)) / (list.length + model.prior_strength));
    const multiple = Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk));
    categories.push({ category, live_count: list.length, live_median: round4(catMedian), multiple: round4(multiple) });
  }
  return { global_median: round4(globalMedian), global_count: ratios.length, categories };
}

/**
 * The model's backtest: predict each live-token protocol's market cap with the same function that
 * scores the board, calibrating without the protocol being predicted (leave-one-out), and compare
 * with its actual market cap. Protocols with no token, CEXes, and ratios above 20x (a tiny TVL
 * makes the ratio a data artifact, not a market) are left out. The median factor is the median of
 * |log(predicted / actual)|, expressed as a multiple: 5.0x means the typical prediction is off by a
 * factor of five either way — market caps vary ~30x around their median, so no ten-field model
 * predicts one precisely, and the honest number is stated rather than hidden.
 */
export function validateModel(snapshot: Snapshot, model: ModelConstants = MODEL): Validation {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0 && p.mcap_usd / p.tvl_usd <= 20,
  );
  const errors: number[] = [];
  let within2 = 0;
  let within3 = 0;
  for (const p of live) {
    const cal = calibrate(snapshot, model, p.slug);
    const pred = impliedValue(p, snapshot.as_of, cal, model).implied;
    const err = Math.abs(Math.log(pred / p.mcap_usd!));
    errors.push(err);
    if (err <= Math.log(2)) within2++;
    if (err <= Math.log(3)) within3++;
  }
  errors.sort((a, b) => a - b);
  const medianErr = medianOf(errors) ?? 0;
  return {
    n: live.length,
    median_factor: round4(Math.exp(medianErr)),
    within_2x: live.length === 0 ? 0 : round4(within2 / live.length),
    within_3x: live.length === 0 ? 0 : round4(within3 / live.length),
  };
}

/** The category multiple for one protocol, from the calibration; the global median when unlisted. */
export function categoryMultiple(category: string | null, calibration: Calibration): { multiple: number; liveCount: number } {
  const key = category ?? 'Other';
  const found = calibration.categories.find((c) => c.category === key);
  if (found !== undefined) return { multiple: found.multiple, liveCount: found.live_count };
  return { multiple: calibration.global_median, liveCount: 0 };
}

/** The multipliers and the implied value one protocol gets under `model` and `calibration`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  categoryMultiple: number;
  categoryLiveCount: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, liveCount } = categoryMultiple(protocol.category, calibration);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + model.maturity_range * (Math.max(ageForModel, 0) / (Math.max(ageForModel, 0) + model.maturity_half_life_days));
  const chainMult = 1 + model.chain_bonus_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_bonus_max_chains);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple: multiple, categoryLiveCount: liveCount, growthPct, growthMult, maturityMult, chainMult, age };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
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

/** What one transaction costs on a chain, in the words a farmer budgets by. */
function gasFor(chain: string): { perTx: string; setup: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { perTx: 'about $8 of gas', setup: 'about $15 of gas' };
  if (c === 'solana') return { perTx: 'under $0.10 of gas', setup: 'under $1 of gas' };
  if (c === 'bitcoin') return { perTx: 'about $2 of network fees', setup: 'about $5 of network fees' };
  if (
    ['base', 'arbitrum', 'optimism', 'polygon', 'linea', 'zksync era', 'blast', 'scroll', 'mode', 'mantle', 'zora', 'fraxtal', 'ink', 'abstract', 'soneium', 'unichain', 'world chain'].includes(c)
  ) {
    return { perTx: 'about $0.50 of gas', setup: 'about $2 of gas' };
  }
  return { perTx: 'about $2 of gas', setup: 'about $5 of gas' };
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and keep both positions open.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('basis')) return `Deposit $${capital} into ${name}'s basis strategy on ${chain} and hold the position through one funding cycle.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking pool')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in its app at least once.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('perps')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one position on a market that settles after 30 days.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('stable')) return `Mint or hold $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${name}'s chain and use two of its apps at least once each.`;
  if (c.includes('payment')) return `Send $${capital} through ${name} in two or more transfers a month apart.`;
  if (c.includes('farm')) return `Deposit $${capital} of LP tokens into ${name}'s farm on ${chain} and keep them staked.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('privacy')) return `Move $${capital} through ${name}'s private transfer on ${chain} and keep the receipt.`;
  if (c.includes('options')) return `Deposit $${capital} into ${name}'s options vault on ${chain} and hold through one epoch.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's main risk, in one plain sentence. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Watch the collateral ratio: a sharp price drop can liquidate the borrow, so keep the loan well under half the deposit.';
  if (c.includes('dex')) return 'Expect impermanent loss if the pool price moves far: the LP share can be worth less than holding the two assets.';
  if (c.includes('yield')) return 'The vault rate moves with the market, and a vault contract is a smart-contract risk: never deposit more than you can lose.';
  if (c.includes('basis')) return 'A basis trade loses when funding rates flip: check the funding rate weekly and exit if it stays negative.';
  if (c.includes('rwa')) return 'Real-world assets carry issuer and regulatory risk on top of smart-contract risk: read what backs the token before minting.';
  if (c.includes('restak') || c.includes('staking')) return 'Staked assets can be slashed and may take days to unstake: keep an exit window in mind before you lock up.';
  if (c.includes('bridge')) return 'Bridges have been the largest exploit target in DeFi: bridge only what you need, and move funds out again after using them.';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('perps')) return 'Leveraged positions liquidate fast: keep leverage low and set the position size so a 20% move cannot wipe it.';
  if (c.includes('prediction')) return 'A prediction position pays nothing if the market resolves against you: size it as a lottery ticket, not an investment.';
  if (c.includes('insurance')) return 'Cover pays only on the terms the policy states: read the exclusions before you buy, or a claim may be refused.';
  if (c.includes('stable')) return 'A stable asset can depeg: watch its price against $1 and exit if it trades below $0.98 for more than a day.';
  if (c.includes('curator') || c.includes('allocator')) return 'A curator vault is only as good as its manager: check what the vault holds and who can change its strategy.';
  return 'Every position is a smart-contract risk: read the protocol docs, never deposit more than you can lose, and keep an exit plan.';
}

/** The category's weekly action: the recurring step that keeps the farm counted, specific to what the protocol does. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Top up the supply or repay a little of the borrow on ${name} once a week, so the position shows fresh activity.`;
  if (c.includes('dex')) return `Swap a small amount through ${name}'s pool once a week, or add a little more liquidity to the position.`;
  if (c.includes('yield')) return `Check the vault rate on ${name} once a week and add to the vault when the rate is near its recent high.`;
  if (c.includes('basis')) return `Check ${name}'s funding rate once a week and keep the position open while funding stays positive.`;
  if (c.includes('rwa')) return `Check what backs ${name}'s asset once a week and add a little more when a new issuance is announced.`;
  if (c.includes('restak') || c.includes('staking')) return `Check the staking yield on ${name} once a week and restake any rewards the protocol pays out.`;
  if (c.includes('bridge')) return `Bridge a small amount through ${name} once a week and use the funds in its app, so the wallet stays active on both sides.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('perps')) return `Adjust the hedged position on ${name} once a week so it stays delta-neutral as prices move.`;
  if (c.includes('prediction')) return `Place one small position a week on ${name}, on markets that settle on different dates.`;
  if (c.includes('curator') || c.includes('allocator')) return `Check what ${name}'s vault holds once a week and move to a better vault if the strategy changes.`;
  if (c.includes('chain')) return `Use one app on ${name}'s chain each week: a swap, a mint or a vote, so the wallet has a steady history.`;
  if (c.includes('payment')) return `Send one payment through ${name} each week, varying the amount and the recipient.`;
  return `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'nothing to create, and never share the seed phrase',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p, chain),
      cost: `${gas.perTx} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Check the protocol's own points or rewards page once a month, and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes a month',
    },
    {
      text: riskFor(p),
      cost: 'no cost to check, and it can save the position',
      time: '10 minutes a week',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: EVERY rankable pre-token protocol below the watchlist floor, not just the largest.
  // Above-floor protocols the watchlist leaves out stay out: the house's rule left them out because
  // they are wrapped, staked or bridged products of a token that already trades, or a parent protocol's
  // product, so they are not standalone launches.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const watchlistSet = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, calibration, model);
    return { p, ...v };
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
    on_watchlist: watchlistSet.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      category_live_count: s.categoryLiveCount,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
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
      mcap_tvl_ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
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
    on_watchlist: row.on_watchlist,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, calibration, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    validation: validateModel(snapshot, model),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
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
  if (board.length < 100 || board.length > 4000) return `the board has ${board.length} rows, outside the gate's 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
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
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
