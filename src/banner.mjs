/**
 * The NINA banner.
 *
 * Printed on every invocation. This is not decoration and is not a candidate for
 * "quiet mode" trimming — see the project memory `nina-cli`.
 */

/** ANSI-Shadow block lettering for the CLI name — six lines, by design. */
const ART = [
  String.raw` ███╗   ██╗ ██╗ ███╗   ██╗  █████╗`,
  String.raw` ████╗  ██║ ██║ ████╗  ██║ ██╔══██╗`,
  String.raw` ██╔██╗ ██║ ██║ ██╔██╗ ██║ ███████║`,
  String.raw` ██║╚██╗██║ ██║ ██║╚██╗██║ ██╔══██║`,
  String.raw` ██║ ╚████║ ██║ ██║ ╚████║ ██║  ██║`,
  String.raw` ╚═╝  ╚═══╝ ╚═╝ ╚═╝  ╚═══╝ ╚═╝  ╚═╝`,
];

/** The one pink — the deepest tone of the gradient this replaced. */
const PINK = [225, 45, 130];

/**
 * Palettes, one color per line of the art.
 *
 * `pink` is the default: one hue deepening down the block. `pink-flat` is the same hue
 * held at its deepest for every line. `rainbow` is the 1977 Apple logo, top to bottom —
 * six stripes for six lines; handsome, but six hues cut across the glyphs and the word
 * gets harder to read.
 */
const PALETTES = {
  'pink-flat': Array.from({ length: 6 }, () => PINK),
  rainbow: [
    [97, 187, 70], // green
    [253, 184, 39], // yellow
    [245, 130, 31], // orange
    [224, 58, 62], // red
    [150, 61, 151], // purple
    [0, 157, 220], // blue
  ],
  pink: [
    [255, 196, 224],
    [255, 166, 209],
    [255, 133, 191],
    [255, 100, 173],
    [247, 70, 152],
    [225, 45, 130],
  ],
};

/** True when the terminal should be given escape codes at all. */
const useColor = () => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

/**
 * Wraps text in a 24-bit foreground color.
 *
 * @param {[number, number, number]} rgb - The color.
 * @param {string} text - The text to wrap.
 * @returns {string} The text, colored if the terminal takes color.
 */
const paint = ([r, g, b], text) =>
  useColor() ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m` : text;

/** The subtitle, in the same pink held back so it sits under the name. */
const subtitle = (s) =>
  useColor() ? `\x1b[2m\x1b[38;2;${PINK.join(';')}m${s}\x1b[0m` : s;

/**
 * Prints the banner to stdout.
 *
 * @param {string} version - The CLI version, shown under the art.
 * @param {string} [theme] - Palette name; defaults to `NINA_THEME`, else `pink`.
 */
export function printBanner(version, theme = process.env.NINA_THEME ?? 'pink') {
  const palette = PALETTES[theme];
  const lines = palette ? ART.map((line, i) => paint(palette[i], line)) : ART;
  process.stdout.write(`\n${lines.join('\n')}\n`);
  process.stdout.write(subtitle(`  harness orchestration · v${version}\n\n`));
}
