// Root dev launcher — starts the whole Veyra stack with one command.
//
//   node dev.js   (or: npm run dev)
//
// Boots in order:
//   1. Dev MongoDB  (server/scripts/dev-mongo.js, 127.0.0.1:27017)
//   2. NestJS API   (server, http://localhost:3001)  — after Mongo is ready
//   3. Next.js app  (client, http://localhost:3000)
//
// Zero dependencies. Ctrl+C stops everything.
const { spawn } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const SERVER = path.join(ROOT, 'server');
const CLIENT = path.join(ROOT, 'client');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];

// ANSI colours so each process is easy to tell apart in the merged output.
const C = { mongo: '\x1b[35m', server: '\x1b[36m', client: '\x1b[32m', reset: '\x1b[0m' };

function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, shell: true, env: process.env });
  const tag = `${C[name] || ''}[${name}]${C.reset} `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) out.write(tag + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited with code ${code}\n`);
    shutdown(code || 0);
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', c.pid, '/f', '/t']);
      else c.kill('SIGTERM');
    } catch {}
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Start Mongo, then start API once it signals readiness.
const mongo = spawn('node', [path.join(SERVER, 'scripts', 'dev-mongo.js')], {
  cwd: SERVER,
  shell: true,
  env: process.env,
});
children.push(mongo);

const mongoTag = `${C.mongo}[mongo]${C.reset} `;
let started = false;
let mbuf = '';
mongo.stdout.on('data', (d) => {
  mbuf += d.toString();
  const lines = mbuf.split('\n');
  mbuf = lines.pop();
  for (const line of lines) {
    process.stdout.write(mongoTag + line + '\n');
    if (!started && line.includes('MEMORY_MONGO_READY')) {
      started = true;
      process.stdout.write(`${mongoTag}ready → starting API + client\n`);
      run('server', npm, ['run', 'start:dev'], SERVER);
      run('client', npm, ['run', 'dev'], CLIENT);
    }
  }
});
mongo.stderr.on('data', (d) => process.stderr.write(mongoTag + d.toString()));
mongo.on('exit', (code) => {
  process.stdout.write(`${mongoTag}exited with code ${code}\n`);
  shutdown(code || 0);
});
