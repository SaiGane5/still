import "@testing-library/jest-dom/vitest";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://still@localhost:5544/still_test";
process.env.AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.STILL_SEED_DEMO = "0";
