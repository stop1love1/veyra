# Veyra Server

NestJS + MongoDB API for Veyra.

## Prerequisites

- Node.js (LTS) and npm
- A running MongoDB instance (local or remote)

## Setup

```bash
cp .env.example .env
```

Then edit `.env` and set:

- `MONGO_URI` — MongoDB connection string (default `mongodb://127.0.0.1:27017/veyra`)
- `JWT_SECRET` — **required**, strong unique secret (min 16 chars)
- `JWT_REFRESH_SECRET` — **required**, must differ from `JWT_SECRET`
- `CLIENT_ORIGIN` — allowed CORS origin(s), comma-separated (default `http://localhost:3000`)
- `PORT` — HTTP port (default `3001`)

> The server refuses to start if `JWT_SECRET` / `JWT_REFRESH_SECRET` are missing,
> too short, identical, or set to a known placeholder value.

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Install dependencies:

```bash
npm install
```

## Run

```bash
# development (watch mode), serves on http://localhost:3001
npm run start:dev

# production
npm run build
npm run start:prod
```

The API is mounted under the `/api` global prefix.

## Seed

Populate the database with the demo world (items, shops, products, the
`veyra-central` map, etc.):

```bash
npm run seed
```

## Test

```bash
npm run test       # unit tests
npm run test:e2e   # end-to-end tests
npm run test:cov   # coverage
```
