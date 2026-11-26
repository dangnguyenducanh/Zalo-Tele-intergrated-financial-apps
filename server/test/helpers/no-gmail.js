// Vitest setup file, run before every test file (vitest.config.js). A test must never send real mail, so whatever
// GMAIL_* the shell, a CI secret or a copied server/.env put into the environment is removed before the app reads it
// (docs/07 §7.10.5). Tests that need mail on set them on `env` themselves and replace delivery (services/mail.js).
delete process.env.GMAIL_USER;
delete process.env.GMAIL_APP_PASSWORD;
