<!-- nina:slot money.1 -->
3. **An outbound transfer is idempotent — it is NEVER sent twice.** Every transfer carries an idempotency key, and deduplication happens at a single serialization point **before** the side effect, never after it. A retry, a re-delivered queue message, a double-click and a replayed webhook must all collapse to one transfer. This is the highest-blast-radius invariant in the system: almost everything else can be corrected afterwards, and a duplicated transfer cannot.

<!-- nina:slot money.2 -->
4. **Conservation — what comes in equals what goes out plus what is retained.** A distribution may NEVER exceed the amount it distributes → **block**. If it is **less**, **alert** and leave the remainder **parked** and visible — never silently distributed, never silently absorbed. All arithmetic is integer {{MINOR_UNIT}}; percentages are basis points. The LLM never computes a monetary value.

<!-- nina:slot money.3 -->
5. **State-machine integrity.** Every money-moving entity has an explicit set of states and legal transitions, declared in `.claude/architecture.md` § *State machines* — not inferred from whatever code happens to exist. Only declared transitions are legal; an illegal one throws and is never silently coerced. **Every transition writes an audit row** (entity, id, from → to, actor, when). Skipping a state, inventing one, or landing a transition with no audit row is a hard reject.

<!-- nina:slot money.4 -->
- **money movement**: anything that creates, moves, settles or records a balance
