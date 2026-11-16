// Pre-Token Radar: snapshot in, ranked board out (Node 22, standard library only).
//
// The program reads the sealed snapshot (mounted at /input in the grading
// sandbox, or --input <file|dir> locally), scores every pre-token protocol
// with the calibrated model in lib/model.ts, and writes the entry's outputs:
//   board.json    the ranked board (200 rows: full watchlist + early finds)
//   data.js       the dashboard's dataset, beside the page
//   dashboard/    the static page, copied as-is
//   screenshots/  the three views of the page, copied as-is
//   dossier.json  the judge's dossier, written last with the vendored library
//
// Everything is deterministic: the same snapshot always produces byte-identical
// outputs. No network, no clock, no randomness anywhere in this program.
//
// Run it in the grading sandbox with /input and /output mounted (the defaults
// below); locally pass --input <snapshot.json|directory> --output <dir>.
// board.json carries { rows } — the gate also reads a bare array of rows.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Caps the scorer enforces on the dossier and its parts. */
const TEXT_MAX_BYTES = 65_536;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 524_288;
const DASH_MAX_FILES = 400;
const DASH_MAX_BYTES = 4_194_304;

/** A screenshot's file name: letters, digits and . _ -, 1 to 128 characters. */
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>` or `--name=<value>`, else `fallback`. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1] as string;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

/** Fail with a message on stderr and a non-zero exit. */
function fail(message: string): never {
  process.stderr.write(`pre-token radar: ${message}\n`);
  process.exit(1);
}

// --- input ----------------------------------------------------------------

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
}

const out = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

// --- outputs ---------------------------------------------------------------

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dot-names; return the names. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
if (dashFiles.length === 0) fail('dashboard/ holds no files: the page is part of the entry');
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and
// compares the bytes, so nothing may change after this line.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SHOT_MAX, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: DASH_MAX_FILES, max_bytes: DASH_MAX_BYTES },
  }),
);

process.stdout.write(
  `pre-token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `pre-token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
