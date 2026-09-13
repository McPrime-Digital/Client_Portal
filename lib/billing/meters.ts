/**
 * THE METER MODEL — what each kind of usage IS, economically.
 *
 * ── WHY THIS EXISTS BEFORE STORAGE AND SEATS COST ANYTHING ─────────────────
 *
 * Today only AI spends: `ai.text.tokens` and `primeos` carry cents;
 * `storage.bytes` and `seat.invited` are metered at zero. The owner intends to
 * charge for storage and seats later, and the naive version of that change —
 * give them a rate, let them flow into the same total — produces WRONG NUMBERS
 * in the one place that must not be wrong.
 *
 * The reason is that they are not the same kind of cost:
 *
 *   FLOW      an event costs money once, and never again. An AI call.
 *             Spend varies with activity. Stop working and it goes to zero.
 *
 *   STOCK     a quantity HELD costs money per period. Storage: 400 GB costs
 *             every month it is held, whether or not anyone uploads. The
 *             `storage.bytes` events record DELTAS, so summing their cents
 *             answers "what did we add this month", not "what are we paying".
 *
 *   RECURRING a count occupied costs per period. Seats. `seat.invited` fires
 *             ONCE per person, at invite; the charge continues for as long as
 *             they hold the seat. Summing invite events answers "how many
 *             joined", which in a steady month is ZERO while the bill is not.
 *
 * Mixing these breaks three things at once:
 *   · BURN RATE, which is meaningful for flow and meaningless for a standing
 *     charge — storage does not "burn", it is owed.
 *   · RUNWAY, which must divide the balance by flow PLUS the standing charge,
 *     not by a blended average that under-counts the floor.
 *   · THE ANOMALY DETECTOR, which compares today against a normal day. A
 *     monthly seat charge landing on the 1st would read as a 30× spike every
 *     month, and an alert that cries wolf on a schedule is worse than none.
 *
 * So the shape is declared now, while every rate is zero and nothing can break,
 * rather than discovered on the first month storage is billed.
 *
 * TURNING ON A CHARGE IS A ONE-LINE EDIT HERE. Nothing downstream branches on a
 * kind string; it asks this table what the kind is.
 */

export type MeterShape = 'flow' | 'stock' | 'recurring'

export type Meter = {
  /** usage_events.kind */
  readonly kind: string
  readonly shape: MeterShape
  /** What one unit is, for the surface to say out loud. */
  readonly unit: string
  /** Human label. */
  readonly label: string
  /**
   * Cents per unit per PERIOD for stock/recurring, or per unit for flow.
   * Zero means metered but not charged — the live state for storage and seats.
   * AI is null because its rate is per MODEL, not per kind: lib/credits.ts's
   * RATE_CENTS_PER_1K is the authority and the event carries the model in `ref`.
   */
  readonly rateCents: number | null
  /**
   * Can this kind be traced to a PRODUCTION, and how?
   *   'direct'   the event carries the project
   *   'via-file' the event carries file_id, and files carry project_id
   *   'none'     no path exists today
   * Chargeback is the enterprise ask — a studio bills a client for the work done
   * on their production — and it is only as good as this column.
   */
  readonly allocation: 'direct' | 'via-file' | 'none'
}

export const METERS: Readonly<Record<string, Meter>> = {
  'ai.text.tokens': {
    kind: 'ai.text.tokens', shape: 'flow', unit: 'tokens', label: 'AI generation',
    rateCents: null,
    // CLOSED (0062). The muse route now takes a production, VALIDATES it on the
    // user client — so a caller cannot attribute their spend to a job they
    // cannot see — and writes it to usage_events.project_id. Calls made with no
    // production in scope stay unallocated, which is honest; guessing would put
    // real money on the wrong client's invoice.
    allocation: 'direct',
  },
  primeos: {
    kind: 'primeos', shape: 'flow', unit: 'tokens', label: 'PrimeOS',
    rateCents: null, allocation: 'direct',
  },
  'storage.bytes': {
    kind: 'storage.bytes', shape: 'stock', unit: 'bytes', label: 'Storage',
    // Metered, not charged. When it is charged this becomes cents per GB-month
    // and the STOCK shape already stops it polluting burn and the anomaly check.
    rateCents: 0,
    // Events carry file_id and files carry project_id, so storage IS allocatable
    // to a production the day it becomes billable. The join exists.
    allocation: 'via-file',
  },
  'seat.invited': {
    kind: 'seat.invited', shape: 'recurring', unit: 'seats', label: 'Seats',
    rateCents: 0, allocation: 'none',
  },
}

export function meterFor(kind: string): Meter {
  // An unknown kind is treated as FLOW at an unknown rate — the conservative
  // reading, because a new meter is far likelier to be a per-event charge than a
  // standing one, and misreading a standing charge as flow would understate the
  // floor rather than invent one.
  return METERS[kind] ?? {
    kind, shape: 'flow', unit: 'units', label: kind, rateCents: null, allocation: 'none',
  }
}

/** Only FLOW kinds belong in burn, runway-from-activity and the spike detector.
 *  Stock and recurring are a floor, and a floor is not a rate. */
export function isFlow(kind: string): boolean {
  return meterFor(kind).shape === 'flow'
}

/** Kinds that are metered but not yet charged — the surface says so plainly
 *  rather than showing a confident $0.00, which reads as "free" when it means
 *  "not billed yet". */
export function isMeteredOnly(kind: string): boolean {
  const m = meterFor(kind)
  return m.rateCents === 0
}
