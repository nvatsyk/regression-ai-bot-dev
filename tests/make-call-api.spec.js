import { test, expect } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const API_URL           = 'https://uat-api.nextlevel.ai/app/ext/telecom/call/v2/make-call';
const ORG_ID            = process.env.MAKE_CALL_ORG_ID;
const API_KEY           = process.env.MAKE_CALL_API_KEY;
const AGENT_ID          = process.env.MAKE_CALL_AGENT_ID;
const OUTBOUND_PHONE_ID = process.env.MAKE_CALL_OUTBOUND_PHONE_ID;
const DESTINATION_PHONE = process.env.MAKE_CALL_DESTINATION_PHONE;

const REPORT_DIR  = join(process.cwd(), 'reports');
const REPORT_PATH = join(REPORT_DIR, 'make-call-api-fail-report.csv');
const TEST_NAME   = 'Make Call API — POST /make-call';

function csvEscape(v) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

function logFailure(stepLabel, detail) {
  mkdirSync(REPORT_DIR, { recursive: true });
  const row = [
    new Date().toISOString(), TEST_NAME, stepLabel, detail,
  ].map(csvEscape).join(',') + '\n';
  appendFileSync(REPORT_PATH, row);
}

test.describe.skip('Make Call API — Regression', () => {
  test(TEST_NAME, async ({ request }) => {
    test.setTimeout(30000);

    mkdirSync(REPORT_DIR, { recursive: true });

    // ── Step 1: POST /make-call ────────────────────────────────────────────────
    console.log('[MAKE-CALL] Sending POST request to make-call API...');
    const response = await request.post(API_URL, {
      headers: {
        'Content-Type': 'application/json',
        'x-ai-agent-organization-id': ORG_ID,
        'x-ai-agent-organization-api-key': API_KEY,
      },
      data: {
        agentId: AGENT_ID,
        outboundPhoneId: OUTBOUND_PHONE_ID,
        destinationPhone: DESTINATION_PHONE,
        backgroundInfo: 'Customer callback regarding order #123',
        userLanguage: 'en',
      },
    });

    // ── Step 2: Validate HTTP status ───────────────────────────────────────────
    const status = response.status();
    console.log(`[MAKE-CALL] Response status: ${status}`);
    if (status !== 200) {
      logFailure('Step 2: HTTP status', `Expected 200, got ${status}`);
    }
    expect(status, `Expected HTTP 200 but got ${status}`).toBe(200);
    console.log('[MAKE-CALL] [PASS] HTTP 200');

    // ── Step 3: Validate response body ─────────────────────────────────────────
    const body = await response.json();
    console.log('[MAKE-CALL] Response body:', JSON.stringify(body));

    // callId must be a non-empty string (UUID)
    if (!body.callId) {
      logFailure('Step 3: callId', `callId is missing or null — body: ${JSON.stringify(body)}`);
    }
    expect(body.callId, 'callId should be present in the response').toBeTruthy();
    console.log(`[MAKE-CALL] [PASS] callId: ${body.callId}`);

    // message must contain "Called to"
    if (!body.message || !body.message.includes('Called to')) {
      logFailure('Step 3: message', `Expected message to contain "Called to" — got: ${body.message}`);
    }
    expect(body.message, `message should contain "Called to" — got: "${body.message}"`).toContain('Called to');
    console.log(`[MAKE-CALL] [PASS] message: ${body.message}`);

    // userId must be a non-empty string (UUID)
    if (!body.userId) {
      logFailure('Step 3: userId', `userId is missing or null — body: ${JSON.stringify(body)}`);
    }
    expect(body.userId, 'userId should be present in the response').toBeTruthy();
    console.log(`[MAKE-CALL] [PASS] userId: ${body.userId}`);

    console.log('[MAKE-CALL] All checks passed — Make Call API regression complete.');
  });
});
