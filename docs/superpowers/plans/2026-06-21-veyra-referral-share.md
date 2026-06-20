# Veyra Referral + Share Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Checkbox steps.

**Goal:** A viral referral loop — share a public card carrying your code; when an invited friend reaches Rank 2, both are rewarded.

**Architecture:** A small `ReferralService` (User model only — no Quest dep, avoids a cycle) owns code generation + `maybeAwardReferral`, called after every renown increase. Public `GET /u/:code` feeds a Next public page + dynamic OG image. Register accepts/attributes a referral code.

**Tech Stack:** NestJS + Mongoose (jest), Next 16 App Router + React 19 (vitest). `next/og` for the OG image.

## Global Constraints
- Bilingual `{vi,en}`; VN default. Server from `server/`, client from `client/`.
- **AGENTS.md:** before writing the Next public page / OG image / metadata, READ `client/node_modules/next/dist/docs/` for the App-Router APIs (dynamic routes, `generateMetadata`, `next/og` `ImageResponse`).
- Progression account-bound; reward milestone = renown ≥ 100 (Rank 2). Reward once (atomic flag).
- DO NOT commit unless the user asks.

---

### Task 1: Referral code-gen + maybeAwardReferral (pure-ish + service)
**Files:** Create `server/src/referral/referral.codegen.ts` + `.spec.ts`, `server/src/referral/referral.service.ts`, `referral.module.ts`.
- [ ] `referral.codegen.ts`: `genCode(rand = Math.random): string` → 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no I/O/0/1). Pure (rand injectable). Spec: length 6, charset subset, deterministic with seeded rand.
- [ ] `referral.service.ts`: inject `User` model. Methods:
  - `async uniqueCode(): Promise<string>` — genCode, retry until not found (cap ~5).
  - `async maybeAwardReferral(userId): Promise<void>` — load user `{renown, referredBy, referralRewarded}`; if `renown<100 || !referredBy || referralRewarded` return; `findOneAndUpdate({_id, referralRewarded:false},{referralRewarded:true})` → if null return (raced); `$inc` referee {coins:50, renown:30}; `$inc` referrer (`referredBy`) {coins:100, renown:60, referralCount:1}.
  - `async publicProfile(code)` and `async myReferral(userId)` (see Task 4) — or put in controller/service here.
- [ ] `referral.module.ts`: imports UsersModule; provides+exports ReferralService.
- [ ] jest `referral.codegen` PASS.

### Task 2: User schema + register attribution
**Files:** `users/schemas/user.schema.ts`, `auth/dto/register.dto.ts`, `auth/auth.service.ts`, `auth/auth.module.ts`.
- [ ] User: `referralCode` (String, unique, index, default ''), `referredBy` (ObjectId ref User, default null), `referralRewarded` (Boolean default false), `referralCount` (Number default 0).
- [ ] RegisterDto: `@IsOptional() @IsString() referralCode?: string`.
- [ ] AuthService.register: inject ReferralService (AuthModule imports ReferralModule); on create set `referralCode = await referral.uniqueCode()`; if `dto.referralCode` resolves to a user whose code matches and id≠new → set `referredBy`. (Resolve referrer BEFORE create; set referredBy in the create doc.)
- [ ] tsc clean.

### Task 3: Wire maybeAwardReferral into renown increases
**Files:** `progression/progression.service.ts` (recordEvent, checkin), `quests/quests.service.ts` (claim), respective modules import ReferralModule.
- [ ] Inject ReferralService into ProgressionService + QuestsService.
- [ ] Call `await this.referral.maybeAwardReferral(userId)` after the renown `$inc` in: recordEvent (when gain>0), checkin (when reward.renown>0), quests.claim (when renown granted).
- [ ] ProgressionModule + QuestsModule import ReferralModule. tsc clean; jest pass.

### Task 4: Endpoints — /me/referral, /u/:code
**Files:** `referral/referral.controller.ts`, `referral/referral.service.ts`, `app.module.ts`.
- [ ] Service: `myReferral(userId)` → `{code, count}` (load user). `publicProfile(code)` → find by referralCode; 404 if none; return `{name: name||'Lữ khách', avatarHue: avatar?.hue??0, rankName, rankIndex, renown, streak: streakCount, referralCount}` (use deriveRank from progression.logic).
- [ ] Controller: `@Get('me/referral')` (auth) → myReferral; `@Public() @Get('u/:code')` → publicProfile.
- [ ] Register ReferralModule in app.module. tsc clean.

### Task 5: Client API + state + register code
**Files:** `lib/api/client.ts`, `lib/game/useGameState.ts`, `lib/game/types.ts`, `components/auth/AuthModal.tsx` (+ GateTicket if it registers).
- [ ] api: `getReferral()`, `getPublicProfile(code)`, `register(... referralCode?)`. Types `ApiReferral {code,count}`, `ApiPublicProfile`.
- [ ] useGameState: `referral` state + `refreshReferral()` (authed); read `veyra_ref` from localStorage; `register` passes stored ref then clears it. Read `?ref=` on mount → store `veyra_ref`.
- [ ] AuthModal register path forwards the pending ref code.
- [ ] Game type += `referral`, `refreshReferral`. tsc clean.

### Task 6: Public page + OG image (READ NEXT DOCS FIRST)
**Files:** `app/u/[code]/page.tsx`, `app/u/[code]/opengraph-image.tsx`.
- [ ] Read `client/node_modules/next/dist/docs/` for dynamic route params, `generateMetadata`, and `next/og`.
- [ ] `page.tsx` server component: fetch `${API}/u/:code`; render card + "Vào Veyra" → `/?ref=CODE`; 404 fallback. `generateMetadata` sets OG/twitter image to the opengraph-image route.
- [ ] `opengraph-image.tsx`: `ImageResponse` card (name, rank, renown, streak).
- [ ] `next build` (or dev) renders the route without error.

### Task 7: Passport "Invite friends" section + strings + css
**Files:** `features/passport/PassportScreen.tsx`, `data/strings.ts`, `globals.css`.
- [ ] Add an invite block: code, share link, Copy + Share (Web Share API w/ fallback), `count` invited, "view my card" link. `g.refreshReferral()` on mount.
- [ ] strings: `invite`, `inviteFriends`, `copy`, `copied`, `share`, `invitedCount`, `myCard`. css `.v-invite*`.
- [ ] tsc clean; vitest pass.

### Task 8: Verify e2e
- [ ] `npm run seed`; start server. Smoke: register B with A's code → push B renown≥100 (checkin/progress) → A.coins/renown/referralCount and B reward applied once; 2nd push doesn't re-award; `GET /u/<A code>` returns card; `GET /me/referral` returns code+count.
- [ ] client tsc + vitest.

## Self-Review
- Spec §2 referral data/register/milestone/endpoints → T1,T2,T3,T4. ✓
- Spec §3 public page/OG/ref-capture/invite UI → T5,T6,T7. ✓ §2.3 cycle avoided via ReferralService (User-only) → T1,T3. ✓
- Placeholder scan: reward numbers explicit; the codegen rand is injectable for deterministic tests. ✓
- Type consistency: `maybeAwardReferral(userId)`, `uniqueCode()`, `genCode(rand?)`, `getReferral`/`ApiReferral`, `getPublicProfile`/`ApiPublicProfile` consistent. ✓
