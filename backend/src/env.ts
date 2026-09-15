import dotenv from 'dotenv';
import path from 'node:path';

/**
 * Load the environment before any other module reads process.env.
 *
 * The root .env (repo / install root - see .env.example) is the single source
 * of truth for every service. backend/.env - the copy scripts/env-sync.mjs
 * keeps aligned - still works alone, so an install that was set up before the
 * unified file existed keeps running.
 *
 * dotenv never overwrites a value that is already set, so the precedence is:
 *   real environment (systemd / docker / shell)  >  root .env  >  backend/.env
 *
 * Import this module first: app.config.ts and the Prisma client read
 * process.env while their modules are evaluated.
 */
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
