import "dotenv/config";
// all tests run against the test database, never the dev one
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
process.env.SESSION_SECRET ||= "test-secret-test-secret-test-secret-123";
process.env.APP_URL ||= "http://localhost:3000";
