import dotenv from 'dotenv';
import path from 'node:path';

/**
 * Load the backend's own .env before any other module reads process.env.
 *
 * backend/.env is the single source of truth for everything that runs from
 * the backend directory: the NestJS API, the Prisma CLI (db push) and the
 * admin panel (backend/admin/server.js on the server).
 *
 * dotenv never overwrites a value that is already set, so the precedence is:
 *   real environment (systemd EnvironmentFile / shell)  >  backend/.env
 *
 * Import this module first: app.config.ts and the Prisma client read
 * process.env while their modules are evaluated.
 */
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
