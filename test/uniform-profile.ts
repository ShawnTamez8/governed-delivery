import { DEFAULT_SETTINGS } from "../src/policy.ts";
import { freezeProfile } from "../src/profile.ts";
import type { VerificationConfig } from "../src/governed-config.ts";

/**
 * Freeze a profile in which every dispatch setting is the one model passed and
 * a fixed effort of `medium`.
 *
 * The stage tests were written when one model covered every dispatch, and
 * they pass a hand-written model such as "m" to a stage and expect the run to
 * use it. The seeded defaults now differ per setting, so a profile frozen
 * without overrides would not match that model at the author setting and the
 * stage's `--model` assertion would refuse the run. This freezes uniform
 * settings instead of loosening the assertion. `test/profile.test.ts` is the
 * only place that freezes the real seeded defaults.
 *
 * Not a test file: no `.test.ts` suffix, so `node --test test/*.test.ts` does
 * not run it.
 */
export function freezeUniformProfile(
  rootDir: string,
  runId: number,
  startingCommit: string | null,
  model: string,
  verification: VerificationConfig
): ReturnType<typeof freezeProfile> {
  const names = Object.keys(DEFAULT_SETTINGS);
  return freezeProfile(rootDir, runId, startingCommit, model, verification, {}, {
    modelFor: Object.fromEntries(names.map((name) => [name, model])),
    effortFor: Object.fromEntries(names.map((name) => [name, "medium"])),
  });
}
