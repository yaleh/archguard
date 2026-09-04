/**
 * Shared Dart ignore patterns.
 *
 * Split out from `index.ts` so consumers that only need the ignore lists (e.g.
 * the language-agnostic `TestAnalyzer`) can import them without pulling in the
 * whole plugin (TreeSitterBridge, ArchJsonMapper, pubspec-resolver).
 */

/**
 * Directories/files excluded from Dart project parsing by default. Generated
 * code adds massive mechanical noise (l10n locale classes, asset constants,
 * serialization stubs) that skews architecture metrics — fan-in, entity
 * counts, and package coupling are all inflated by these non-authored files.
 *
 * Covered generators:
 *   - build_runner        → *.freezed.dart / *.g.dart / *.gr.dart
 *   - flutter_gen         → *.gen.dart (assets.gen.dart / fonts.gen.dart)
 *   - intl_utils          → generated/ (l10n.dart + l10n_<locale>.dart)
 *   - custom asset/l10n   → generated/ + l10n.dart / l10n_base.dart
 *
 * Users can extend (but not remove) these via `--exclude` / config.exclude.
 */
export const DART_DEFAULT_IGNORE = [
  '**/build/**',
  '**/.dart_tool/**',
  '**/node_modules/**',
  // build_runner-generated sources.
  '**/*.freezed.dart',
  '**/*.g.dart',
  '**/*.gr.dart',
  // flutter_gen asset/font constants.
  '**/*.gen.dart',
  // intl_utils l10n output + custom asset/l10n generation directory.
  '**/generated/**',
  // Top-level l10n generated entry points that live OUTSIDE generated/ in
  // some projects (mower_common keeps l10n.dart / l10n_base.dart beside the
  // hand-written l10n_s.dart wrapper).
  '**/l10n.dart',
  '**/l10n_base.dart',
];

/**
 * Vendored third-party libraries: pub.dev packages whose source is copied into
 * the tree (typically under `lib/src/<package>/`) instead of declared as a
 * pubspec dependency. Their internal cycles and coupling are upstream library
 * structure, not business architecture, so they are excluded from structural
 * analysis — e.g. `detect_cycles` should not report the RefreshPhysics ⇄
 * RefreshController cycle that is intrinsic to the vendored pull_to_refresh.
 *
 * This is an explicit, maintainable list (there is no reliable heuristic for
 * "which directories are vendored"); add new entries as they are identified.
 */
export const DART_VENDORED_IGNORE = [
  // fluttercandies/pull_to_refresh — vendored into fj_widgets as
  // `lib/src/pull_to_refresh_flutter/` with a `pull_to_refresh_flutter3.dart`
  // barrel entry point.
  '**/pull_to_refresh_flutter/**',
  '**/pull_to_refresh_flutter*.dart',
];

/**
 * Full ignore list for whole-workspace `.dart` scans (e.g. test discovery).
 * Adds `coverage/` on top of the parse + vendored lists; parseProject does not
 * need it (coverage output holds no `.dart` sources) but a bare `.dart`
 * test-file glob can otherwise pick up stale copied sources.
 */
export const DART_SCAN_IGNORE = [...DART_DEFAULT_IGNORE, ...DART_VENDORED_IGNORE, '**/coverage/**'];
