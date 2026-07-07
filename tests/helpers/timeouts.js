/**
 * Canonical timeout budgets shared by the chat-launcher / greeting / response /
 * cloudflare helpers. Individual specs may still override any of these via the
 * `timeoutMs` option on a given helper call — these are just the defaults that
 * replace the previously-scattered 8s/10s/30s/45s/60s/90s literals.
 */
export const TIMEOUTS = {
  PAGE_READY: 90_000,
  CLOUDFLARE: 90_000,
  CHAT_OPEN: 90_000,
  GREETING: 90_000,
  BOT_RESPONSE: 90_000,
  POST_SEND_SETTLE: 8_000,
  POLL_INTERVAL: 2_000,
  POLL_INTERVAL_FAST: 1_500,
  TEST_TOTAL: 180_000,
};
