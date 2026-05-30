#!/usr/bin/env node

/**
 * Admin Management CLI
 * Usage:
 *   node scripts/admin.js create             — interactive prompt to create admin
 *   node scripts/admin.js list               — list all admins
 *   node scripts/admin.js reset-password     — reset an admin's password
 *   node scripts/admin.js delete             — delete an admin
 */

import readline from 'readline';
import bcrypt from 'bcryptjs';
import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from project root
dotenv.config({ path: join(__dirname, '..', '.env') });

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
});

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
};

const ok    = (msg) => console.log(`${c.green}✅ ${msg}${c.reset}`);
const fail  = (msg) => console.log(`${c.red}❌ ${msg}${c.reset}`);
const info  = (msg) => console.log(`${c.cyan}ℹ  ${msg}${c.reset}`);
const warn  = (msg) => console.log(`${c.yellow}⚠  ${msg}${c.reset}`);
const label = (msg) => console.log(`\n${c.bold}${c.cyan}${msg}${c.reset}`);
const hr    = ()    => console.log(`${c.gray}${'─'.repeat(50)}${c.reset}`);

// ─── Readline helpers ─────────────────────────────────────────────────────────
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (question, defaultVal = '') => new Promise((resolve) => {
  const hint = defaultVal ? ` ${c.gray}(${defaultVal})${c.reset}` : '';
  rl.question(`  ${question}${hint}: `, (answer) => {
    resolve(answer.trim() || defaultVal);
  });
});

const askHidden = (question) => new Promise((resolve) => {
  process.stdout.write(`  ${question}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  let password = '';
  process.stdin.on('data', function handler(char) {
    char = char.toString();
    if (char === '\n' || char === '\r' || char === '\u0004') {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', handler);
      process.stdout.write('\n');
      resolve(password);
    } else if (char === '\u0003') {
      process.exit();
    } else if (char === '\u007f') {
      if (password.length > 0) {
        password = password.slice(0, -1);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        process.stdout.write(`  ${question}: ${'*'.repeat(password.length)}`);
      }
    } else {
      password += char;
      process.stdout.write('*');
    }
  });
});

const confirm = async (question) => {
  const ans = await ask(`${question} (y/N)`);
  return ans.toLowerCase() === 'y' || ans.toLowerCase() === 'yes';
};

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdCreate() {
  label('Create New Admin');
  hr();

  const username  = await ask('Username');
  const email     = await ask('Email');
  const fullName  = await ask('Full name');
  const password  = await askHidden('Password');
  const password2 = await askHidden('Confirm password');

  if (!username || !email || !password) {
    fail('Username, email and password are required.');
    return;
  }

  if (password !== password2) {
    fail('Passwords do not match.');
    return;
  }

  if (password.length < 8) {
    fail('Password must be at least 8 characters.');
    return;
  }

  // Check uniqueness
  const exists = await pool.query(
    'SELECT id FROM admins WHERE username = $1 OR email = $2',
    [username, email]
  );
  if (exists.rows.length > 0) {
    fail('An admin with that username or email already exists.');
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO admins (username, email, password_hash, full_name)
     VALUES ($1, $2, $3, $4) RETURNING id, username, email, full_name, created_at`,
    [username, email, hash, fullName || null]
  );

  hr();
  ok(`Admin created successfully!`);
  console.log(`${c.gray}  ID:       ${c.reset}${result.rows[0].id}`);
  console.log(`${c.gray}  Username: ${c.reset}${result.rows[0].username}`);
  console.log(`${c.gray}  Email:    ${c.reset}${result.rows[0].email}`);
  console.log(`${c.gray}  Name:     ${c.reset}${result.rows[0].full_name || '—'}`);
}

async function cmdList() {
  label('All Admins');
  hr();

  const result = await pool.query(
    `SELECT id, username, email, full_name, created_at
     FROM admins ORDER BY created_at ASC`
  );

  if (result.rows.length === 0) {
    warn('No admins found.');
    return;
  }

  result.rows.forEach((admin, i) => {
    console.log(`${c.bold}${i + 1}. ${admin.username}${c.reset}  ${c.gray}(${admin.id})${c.reset}`);
    console.log(`   Email:   ${admin.email}`);
    console.log(`   Name:    ${admin.full_name || '—'}`);
    console.log(`   Created: ${new Date(admin.created_at).toLocaleString()}`);
    if (i < result.rows.length - 1) console.log('');
  });
  hr();
  info(`Total: ${result.rows.length} admin(s)`);
}

async function cmdResetPassword() {
  label('Reset Admin Password');
  hr();

  await cmdList();

  const username  = await ask('\nEnter username to reset password for');
  const admin     = await pool.query('SELECT id, username FROM admins WHERE username = $1', [username]);

  if (admin.rows.length === 0) {
    fail(`Admin "${username}" not found.`);
    return;
  }

  const password  = await askHidden('New password');
  const password2 = await askHidden('Confirm new password');

  if (password !== password2) {
    fail('Passwords do not match.');
    return;
  }

  if (password.length < 8) {
    fail('Password must be at least 8 characters.');
    return;
  }

  const confirmed = await confirm(`Reset password for "${username}"?`);
  if (!confirmed) { info('Cancelled.'); return; }

  const hash = await bcrypt.hash(password, 12);
  await pool.query('UPDATE admins SET password_hash = $1 WHERE username = $2', [hash, username]);
  ok(`Password reset for "${username}".`);
}

async function cmdDelete() {
  label('Delete Admin');
  hr();

  await cmdList();

  const username = await ask('\nEnter username to delete');
  const admin    = await pool.query('SELECT id, username FROM admins WHERE username = $1', [username]);

  if (admin.rows.length === 0) {
    fail(`Admin "${username}" not found.`);
    return;
  }

  const count = await pool.query('SELECT COUNT(*) FROM admins');
  if (parseInt(count.rows[0].count) <= 1) {
    fail('Cannot delete the last admin account.');
    return;
  }

  const confirmed = await confirm(`${c.red}Permanently delete admin "${username}"?${c.reset}`);
  if (!confirmed) { info('Cancelled.'); return; }

  await pool.query('DELETE FROM admins WHERE username = $1', [username]);
  ok(`Admin "${username}" deleted.`);
}

// ─── Entry point ──────────────────────────────────────────────────────────────
const command = process.argv[2];

const commands = {
  create:         cmdCreate,
  list:           cmdList,
  'reset-password': cmdResetPassword,
  delete:         cmdDelete,
};

if (!command || !commands[command]) {
  console.log(`
${c.bold}${c.cyan}Admin CLI${c.reset}

${c.bold}Usage:${c.reset}
  node scripts/admin.js ${c.yellow}<command>${c.reset}

${c.bold}Commands:${c.reset}
  ${c.yellow}create${c.reset}           Create a new admin account
  ${c.yellow}list${c.reset}             List all admin accounts
  ${c.yellow}reset-password${c.reset}   Reset an admin's password
  ${c.yellow}delete${c.reset}           Delete an admin account
`);
  process.exit(0);
}

try {
  await pool.query('SELECT 1'); // test connection
} catch (err) {
  fail(`Database connection failed: ${err.message}`);
  fail('Check your .env DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD.');
  process.exit(1);
}

await commands[command]();
rl.close();
await pool.end();