/**
 * What the compiler knows about surfaces beyond their layers: which ones a repository's files reveal, and
 * which ones only make sense on top of another.
 *
 * A surface is a question about what the project is — does it own persistent data, does it render a screen
 * a person looks at — and its layer states what is true of every project that answers yes. A stack is a
 * surface too, of another kind: `prisma` is how a project reaches the database it owns, and means nothing
 * without one. The database surface used to be both at once, and a project that owned data but had not
 * chosen its client was told its client was Prisma, its reads went through Accelerate and its tenant was
 * `userId`.
 *
 * `init`, `check` and `upgrade` all read this, so a surface's evidence and its prerequisite are stated once.
 */

/** Surfaces a repository reveals by its files. The rest are claims about the domain. */
export const DETECTABLE = [
  { surface: 'db', why: 'a Prisma schema', test: (f) => f.some((p) => p.endsWith('schema.prisma')) },
  { surface: 'prisma', why: 'a Prisma schema', test: (f) => f.some((p) => p.endsWith('schema.prisma')) },
  { surface: 'edge-cf', why: 'a wrangler config', test: (f) => f.some((p) => /(^|\/)wrangler\.(toml|jsonc?)$/.test(p)) },
  { surface: 'frontend', why: 'a Vite config', test: (f) => f.some((p) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(p)) },
  { surface: 'blockchain', why: 'a Foundry or Hardhat config', test: (f) => f.some((p) => /(^|\/)(foundry\.toml|hardhat\.config\.[cm]?[jt]s)$/.test(p)) },
];

/** A stack surface, and the concern it is a stack of: declared without it, its rules have nowhere to land. */
export const NEEDS = { prisma: 'db' };

/**
 * The surfaces a project's files reveal, with the evidence for each.
 *
 * @param {string[]} tree - The project's files, relative to it.
 * @returns {{surface: string, why: string}[]}
 */
export const detected = (tree) => DETECTABLE.filter((d) => d.test(tree)).map(({ surface, why }) => ({ surface, why }));
