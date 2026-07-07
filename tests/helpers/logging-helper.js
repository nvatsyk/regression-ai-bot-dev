/**
 * Shared failure-logging / business-assertion / screenshot conventions —
 * replaces the csvEscape/logFailure/checkPhraseGroups boilerplate that used
 * to be copy-pasted into every spec.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

/**
 * Appends one CSV row (ISO timestamp + the given columns, each escaped) to
 * reportPath, creating the parent directory if needed.
 */
export function logFailure(reportPath, columns) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const row = [new Date().toISOString(), ...columns].map(csvEscape).join(',') + '\n';
  appendFileSync(reportPath, row);
}

/**
 * Returns a spec-scoped CSV path, e.g. reportPathFor('etihad-chatbot') ->
 * <reportDir>/etihad-chatbot-fail-report.csv. Using a per-spec filename
 * (instead of the previously-common shared literal 'fail-report.csv')
 * prevents specs run as separate steps in the same CI job from silently
 * appending into one cross-suite-contaminated file.
 */
export function reportPathFor(specName, reportDir = join(process.cwd(), 'reports')) {
  return join(reportDir, `${specName}-fail-report.csv`);
}

/**
 * Business-content assertion layer: returns the label of the first phrase
 * group with NO matching phrase found on the page, or null if every group
 * matched. Layer this on top of the generic openChat/waitForGreeting/
 * waitForBotResponse mechanical gates when a spec also needs to verify
 * specific wording.
 */
export async function checkPhraseGroups(page, phraseGroups) {
  for (const g of phraseGroups) {
    let matched = false;
    for (const phrase of g.phrases) {
      const count = await page.getByText(phrase, { exact: false }).count().catch(() => 0);
      if (count > 0) { matched = true; break; }
    }
    if (!matched) return g.label ?? g.phrases.join(' | ');
  }
  return null;
}

/** Screenshots to <reportDir>/<filePrefix>-<stage>.png, never throws. */
export async function screenshotStage(page, reportDir, filePrefix, stage) {
  const path = join(reportDir, `${filePrefix}-${stage}.png`);
  await page.screenshot({ path }).catch(() => {});
  return path;
}

/** console.log with a consistent `[PREFIX] message` shape. */
export function log(prefix, msg) {
  console.log(`${prefix} ${msg}`);
}
