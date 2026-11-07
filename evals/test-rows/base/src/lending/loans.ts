/** The kinds of item a branch lends; each has its own daily late fee. */
export type ItemKind = 'book' | 'disc';

/** Where a loan stands. `returned` and `lost` are final: a loan in either never moves again. */
export type LoanState = 'open' | 'returned' | 'lost';

/** Every reason a request can be refused: a closed list, and each one has a message. */
export const REFUSALS = ['same-state', 'already-returned', 'already-lost', 'overdue'] as const;

/** One of the reasons in {@link REFUSALS}. */
export type Refusal = (typeof REFUSALS)[number];

/** A loan of one item. */
export interface Loan {
  /** The loan's id. */
  id: string;
  /** What was lent, which sets its daily late fee. */
  kind: ItemKind;
  /** Where the loan stands. */
  state: LoanState;
  /** When the item is due back. */
  dueOn: Date;
}

/** What a request gives back: the loan as it now is, or why it was refused. */
export type Outcome = { ok: true; loan: Loan } | { ok: false; refusal: Refusal };

/** The daily late fee of each kind, in cents. */
export const DAILY_FEE: Record<ItemKind, number> = { book: 25, disc: 100 };

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** The message shown for each refusal. */
const MESSAGES: Record<Refusal, string> = {
  'same-state': 'The loan is already in that state.',
  'already-returned': 'A returned loan cannot change.',
  'already-lost': 'A lost loan cannot change.',
  overdue: 'An overdue loan cannot be renewed; return it first.',
};

/**
 * The late fee for a loan returned on `returnedOn`, in cents: each day or part of a day past its due date at its
 * kind's daily fee, and nothing when it comes back on time or early.
 *
 * @param loan - The loan; its kind and due date are read.
 * @param returnedOn - When the item came back.
 * @returns The fee, in cents.
 */
export function lateFee(loan: Pick<Loan, 'kind' | 'dueOn'>, returnedOn: Date): number {
  const days = Math.ceil((returnedOn.getTime() - loan.dueOn.getTime()) / DAY_MS);
  return Math.max(0, days) * DAILY_FEE[loan.kind];
}

/**
 * Moves a loan to another state. An open loan may be returned or lost; a final one never moves, and a move to the
 * state a loan is already in is refused.
 *
 * @param loan - The loan to move.
 * @param to - The state asked for.
 * @returns The moved loan, or the refusal.
 */
export function move(loan: Loan, to: LoanState): Outcome {
  if (loan.state === to) return { ok: false, refusal: 'same-state' };
  if (loan.state === 'returned') return { ok: false, refusal: 'already-returned' };
  if (loan.state === 'lost') return { ok: false, refusal: 'already-lost' };
  return { ok: true, loan: { ...loan, state: to } };
}

/**
 * Renews an open loan by a number of days, refused once it is overdue.
 *
 * @param loan - The loan to renew.
 * @param today - The day the renewal is asked for.
 * @param days - How many days to add to its due date.
 * @returns The renewed loan, or the refusal.
 */
export function renew(loan: Loan, today: Date, days: number): Outcome {
  if (today.getTime() > loan.dueOn.getTime()) return { ok: false, refusal: 'overdue' };
  return { ok: true, loan: { ...loan, dueOn: new Date(loan.dueOn.getTime() + days * DAY_MS) } };
}

/**
 * What moving an item between branches charges each one, in cents: the sending branch pays the dispatch fee and the
 * receiving branch the intake fee.
 *
 * @param fees - The two fees the branches agreed.
 * @returns What each side is charged.
 */
export function transferCharges(fees: { dispatch: number; intake: number }): { sender: number; receiver: number } {
  return { sender: fees.dispatch, receiver: fees.intake };
}

/**
 * The message for a refusal.
 *
 * @param refusal - The reason.
 * @returns What the person is told.
 */
export function explain(refusal: Refusal): string {
  return MESSAGES[refusal];
}
