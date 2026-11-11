# ============================================================
# WASL AI — the matrix of the tests (PHASE 04 + PHASE 04 bis of BUILD 03)
# ------------------------------------------------------------
# ⭐ WHAT THIS DOCUMENT IS
#   The evidence of a phase is not one number: it is four groups of
#   tests, one end to end journey, a real browser and a rebuild of the
#   environment from scratch. This file says WHAT each group proves,
#   HOW it is run and WHAT it does NOT prove.
# ⛔ It does not claim any guarantee that the tests did not prove.
#   ⭐ The number of tests is NOT a quality measure: a group is only
#   as good as the property it checks.
# ============================================================

## 1. The groups

| Group | Command | Files | What it proves | What it does NOT prove |
|:-:|---|:-:|---|---|
| ⭐ **unit** | `npm run test:unit` | 26 | the frozen core (`src/core`) decides alone: the capabilities, the state machine, the tenant isolation, the atomicity of a conversation | nothing about the database, the HTTP layer or the deployment |
| ⭐ **integration** | `npm run test:integration` | 28 | the real PostgreSQL and the real HTTP API answer together: the contracts, the identity, the privacy, the deletion, the concurrency, the consistency of two instances, the preparation of a host, **the customer inbox through the API**, **the customer inbox in a real browser**, the static checks of the image, **the customer CRM on the real backend (D-071)**, **the refresh and the lost answer on two instances (D-071)** | nothing about a load that a machine of the production size would see |
| ⭐ **security** | `npm run test:security` | 13 | the boundaries: the isolation of the tenants, the trust boundary, the secrets, the login protection under pressure, **the graded login protection (M-73)**, the protection of the deletion evidence **and its real limits (M-74)**, **the scope of the access of an agent (M-76)** | nothing about a penetration test of a third party |
| ⭐ **recovery** | `npm run test:recovery` | 3 | the backup really restores, encrypted, verified and measured, **and never writes a clear text dump on the disk (M-72)** | nothing about a restore on the hardware of the production |
| ⭐ **e2e** | `npm run e2e` | 1 | the journey of a customer service works from the login to the conversation and the privacy | nothing about a channel other than the local web one |
| ⭐ **all** | `npm run test:all` | — | every group above plus the journey | — |

> ⭐ The group `unit` does not touch the database, so it is the group
> that can be run on a machine without PostgreSQL.

> ⭐ **The four groups are a partition, not an overlap.** The file
> `tests/security-trust-boundary.test.ts` belongs to the group
> `security` only (it was listed in `unit` as well in a first draft,
> which made the sum of the groups 763 while the real total of one run
> was 724 — a misleading number).
<!-- wasl:current-partition 605 + 286 + 127 + 16 = 1034 -->
<!-- wasl:current-total 1034 = 1033 pass + 0 fail + 1 skipped -->

> ⭐⭐ **CURRENT (round #60 · D-084)**: the partition is checked by a TOOL
> (`tools/test_count_audit.py`) and the numbers are read from the LOG of
> a real run, never written by hand ⇒ now:
> **605 + 286 + 127 + 16 = 1034** = the number of `npm test` exactly
> (1033 of the 1034 pass and **1 is SKIPPED**: the dynamic Docker drill,
> see §6).
> ⭐⭐ **The +20 of this round are the acceptance tests of the new
> items** (`tests/ui/inbox-session-isolation.test.ts` = 4 ·
> `tests/ui/inbox-draft-offline.test.ts` = 6 ·
> `tests/ui/tickets-capabilities.test.ts` = 10) ⇒ ⇒ ⇒ ⇒ they are all in
> the `integration` group (they drive the real browser + the real
> PostgreSQL) ⇒ ⇒ ⇒ ⇒ ⇒ the other three groups did not move.
> ⭐⭐ **The tool fails when a published number is not the measured one**
> ⇒ ⇒ ⇒ a number can no longer drift silently.
> ⭐⭐ **The `Files` column of the table above is derived from
> `package.json`** (the scripts `test:unit` · `test:integration` ·
> `test:security` · `test:recovery`) ⇒ ⇒ ⇒ it cannot drift from the
> real commands.
> ⭐⭐⭐ **M96**: the CURRENT table is here (§1) and the HISTORY is §8
> ⇒ ⇒ ⇒ a number of an old phase is never overwritten by a new one.
>
> ⭐⭐⭐ **The partition is a partition AND the files are isolated (D-071).**
> The files run in parallel over ONE database ⇒ a file that uses the
> shared seeded company (`tnt_alpha`) depends on the moment another
> file wipes it (five files call `resetSyntheticData`) ⇒ **the first
> run of PHASE 02 showed 11 failures that were NOT defects of the
> product** (a wiped fixture, a rate-limit budget consumed by another
> file, a passcode missing in the middle of a re-seed).
> ⇒ **The new files of this phase own their companies** (`tnt_d071_scope`
> · `tnt_d071_crm` · `tnt_d071_sync` · `tnt_b03_ui2`) through the new
> helper `createSyntheticCompany()` ⇒ **a drill that counts measures
> its own rows and nothing else.**
> ⇒ **The residual risk between the OLD files stays and is declared:**
> they still share `tnt_alpha` ⇒ **one company per file is a structural
> decision that belongs to the owner.**

## 2. The environment of the measurement

| Item | Value |
|---|---|
| ⭐ operating system | Debian GNU/Linux 12 (bookworm) |
| ⭐ Node.js | v22.19.0 (`--experimental-strip-types`) |
| ⭐ npm | 10.9.3 |
| ⭐ PostgreSQL | 15.19 (Debian 15.19-0+deb12u1) — local, loopback only |
| ⭐ pg_dump / pg_restore | 15.19 |
| ⭐ OpenSSL | 3.0.20 (the local TLS test of M-70) |
| ⭐ git | 2.39.5 |
| ⭐ CPU / memory | 2 cores / 3072 MB |
| ⭐ **Docker** | ⭐ **20.10.24** (Debian `docker.io`) — ⭐ the daemon RUNS and the images are pulled and unpacked ⇒ ⛔ **but no container starts** (the sandbox masks parts of `/proc` and the kernel refuses a new `procfs` inside a user namespace) ⇒ **the image was NOT built** |
| ⭐ **Chromium** | ⭐ **1254** (Playwright, headless shell) — the browser drill of the inbox |
| ⭐ database | `wasl_local`, roles `wasl_app` (request) and `wasl_owner` (migration) |
| ⭐ data | ⭐ **synthetic only**: three seeded companies, no real data, no real credential |

## 3. The commands

```bash
# the database (the local synthetic one)
export WASL_PG_SUPERUSER_URL='postgresql://postgres:<local>@127.0.0.1:5432/postgres'
npm run db:setup            # the roles, the migrations, the seed, the credentials file

# the groups
npm run test:unit
npm run test:integration
npm run test:security
npm run test:recovery
npm run e2e
npm run test:all            # the four groups and the journey

# the database from scratch
npm run db:rebuild -- --yes # it refuses without --yes: the data is protected

# the backup
npm run db:backup           # the encrypted artifact and its manifest
npm run db:verify -- <artifact file>
npm run db:restore -- <artifact file> --target <scratch database>
```

> ⭐⭐ The privileged connection is needed by the group `recovery` and
> by the command `db:backup`. Without it the drill is **SKIPPED** and
> the skip is visible in the report of the run (`# skipped 1`): it is
> never hidden behind a success.

## 4. The rules of the measurement

1. ⭐ **A number is published only after it was measured in the same
   session.** Every number of the report comes from a log file of the
   run that produced it.
2. ⭐ **A failure is never hidden.** A refused test stays refused and
   the summary shows it (`# fail`, `# skipped`).
3. ⭐ **The suite is run twice** and the two results are compared: a
   test that depends on the order or on a leftover row shows up.
4. ⭐ **The environment is rebuilt from scratch** (`db:rebuild`) and
   the journey is run again: the seed, the migrations and the journey
   do not depend on the order of the commands.
5. ⭐ **The core is frozen**: `src/core` has zero changed lines
   compared with the baseline `d1b17ae`.

## 5. The negative scenarios that are covered

| Scenario | Where |
|---|---|
| ⭐ a duplicated message reference | M-66a |
| ⭐ two instances at the same time | M-01b, M-66e |
| ⭐ a stale conversation after a restart | M-66c, M-66d |
| ⭐ a wrong passcode, a budget, a distributed attack | M-02b, M-67b |
| ⭐ a spoofed `X-Forwarded-For` | M-67c |
| ⭐ a session expired, revoked, disabled | M-67e |
| ⭐ a flood of guesses during the health check | M-67f |
| ⭐ a forged deletion evidence | M-03a, M-03b, M-68a |
| ⭐ a privileged manipulation of the evidence | M-68c |
| ⭐ a deletion that fails before the commit | M-03d, M-68f |
| ⭐ an answer lost after the commit | M-68h |
| ⭐ a re-sent deletion request | M-03d, M-68e |
| ⭐ a corrupted backup | M-69c |
| ⭐ a replaced backup | M-69e |
| ⭐ a backup with open permissions | M-69d |
| ⭐ a broken sensitive configuration | M-70f |
| ⭐ a connection dropped during the deletion | M-03e |
| ⭐⭐ a clear text dump on the disk during the backup | M-72a (a witness that reads the directory every 5 ms) |
| ⭐⭐ a failure before / during / after the copy | M-72b, M-72c, M-72d |
| ⭐⭐ a big database that must not be loaded in memory | M-72e (a 51 MB table ⇒ a dump above 20 MB ⇒ the memory grows by less than half of it) |
| ⭐⭐ a truncated or a replaced backup | M-72f |
| ⭐⭐ an attacker that spends the platform budget before a legitimate login | M-73a (the legitimate login succeeds) |
| ⭐⭐ a company that floods while another one logs in | M-73c (the second company is not slowed down) |
| ⭐⭐ the ceiling of the key derivations per second | M-73d (five attempts at two per second) |
| ⭐⭐ a spoofed header that buys a fresh budget | M-73f |
| ⭐⭐ a privileged manipulation of the deletion evidence | M-74d, M-74e (the limit is measured, not claimed) |
| ⭐⭐ a double send of the same reply | IN-04 (the same reference twice is refused) |
| ⭐⭐ a company that reads the conversations of another one | IN-08 |
| ⭐⭐ an employee without the capability | IN-09 |
| ⭐⭐ a revoked session | IN-11 |
| ⭐⭐ two backends on one database | IN-13 |
| ⭐⭐ the page that must not show what it hides | UI-02b |

## 6. What is still NOT proven

- ⛔ The image was **not built** and no compose was **not** run: the
  Docker daemon answers and the images are unpacked, but **no container
  starts** in this sandbox (the `/proc` masks of the sandbox and the
  rule of the kernel that refuses a new `procfs` inside a user
  namespace). ⭐ The drill is **SKIPPED with the measured reason** and
  it is never counted as a pass. ⭐ The static checks of the image and
  of the compose file **do** run (and they found a real defect: the
  PostgreSQL driver was a development dependency, so the image would
  have started without it).
- ⛔ The restore was **not** measured on the hardware of the
  production: the RTO of the drill is a local measurement.
- ⛔ The off-host copy of the backup is a **design**, not a transfer:
  nothing was copied outside of the machine.
- ⛔ There is **no** penetration test of a third party, no audit of
  the code and no certification.
- ⛔ The load is **synthetic and bounded**: it proves that the health
  check answers during a burst of guesses, not the capacity of the
  production.
- ⛔ The readiness of the installation stays at **9/21**: the owner
  directive D-069 did not move it.

## 7. The measured results of the round

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline, before the first change | **687/687** · 0 fail · 0 skipped | `/tmp/p02-baseB-test.log` |
| ⭐ 1 | `npm test` (the first run) | **724/724** · 0 fail · 0 skipped | `/tmp/p02-run1.log` |
| ⭐ 2 | `npm test` (the repeat) | **724/724** · 0 fail · 0 skipped | `/tmp/p02-run2.log` |
| ⭐ 3 | `npm run e2e` | **JOURNEY OK** (15/15) | `/tmp/p02-e2e.log` |
| ⭐ 4 | `npm run db:rebuild -- --yes` | **EXIT=0** (5 migrations + 3 seeded companies) | `/tmp/p02-rebuild.log` |
| ⭐ 5 | `npm run e2e` after the rebuild | **JOURNEY OK** | `/tmp/p02-e2e-after-rebuild.log` |
| ⭐ 6 | `npm test` after the rebuild | **724/724** · 0 fail · 0 skipped | `/tmp/p02-test-after-rebuild.log` |
| ⭐ 7 | `npm run test:unit` | **559/559** | `/tmp/p02-grp-unit.log` |
| ⭐ 8 | `npm run test:integration` | **79/79** | `/tmp/p02-grp-integration.log` |
| ⭐ 9 | `npm run test:security` | **77/77** | `/tmp/p02-grp-security.log` |
| ⭐ 10 | `npm run test:recovery` | **9/9** | `/tmp/p02-grp-recovery.log` |
| ⭐ 11 | `npm run test:server` | **126/126** | `/tmp/p02-server.log` |

### The measured results of PHASE 01 (BUILD 03) — ٧ نوفمبر ٢٠٢٦

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline, before the first change | **724/724** · 0 fail · 0 skipped | `/tmp/baseline-full.log` |
| ⭐ 1 | `npm test` (after the phase) | **774** · **773 pass** · **0 fail** · **1 skipped** | `/tmp/full2.log` |
| ⭐ 2 | `npm run test:unit` | **559/559** | `/tmp/groups.log` |
| ⭐ 3 | `npm run test:integration` | **107/108** · 1 skipped (the Docker drill) | `/tmp/groups.log` |
| ⭐ 4 | `npm run test:security` | **91/91** | `/tmp/groups.log` |
| ⭐ 5 | `npm run test:recovery` | **16/16** | `/tmp/groups.log` |
| ⭐ 6 | `npm run e2e` | **JOURNEY OK** (15/15) | `/tmp/e2e2.log` |
| ⭐ 7 | `npm run test:server` | see §7 of the report | — |

> ⭐ **The one skipped test of the whole suite is the dynamic Docker
> drill**, and the skip carries the measured reason. It is an
> environmental limit (the kernel of the sandbox), not a defect of the
> code, and it is not hidden behind a success.

> ⭐⭐ **A note on the privileged connection.** Without
> `WASL_PG_SUPERUSER_URL` the group `recovery` is **SKIPPED** and the
> backup drill cannot run at all: the baseline without it was 717 tests
> / 715 passed / 2 skipped. ⭐ The number **724** appears only with the
> privileged connection ⇒ ⭐ **the comparison of the phases is only
> valid with it.**

### ⭐⭐ The measured results of PHASE 03 (BUILD 03) — ٧ نوفمبر ٢٠٢٦

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of the phase, before the first change | **812** · 811 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 1 | `npm run test:unit` (round 1) | **559/559** | `g1-unit.log` |
| ⭐ 2 | `npm run test:integration` (round 1) | **146/147** · 1 skipped (the Docker drill) | `g1-integration.log` |
| ⭐ 3 | `npm run test:security` (round 1) | **105/105** | `g1-security.log` |
| ⭐ 4 | `npm run test:recovery` (round 1) | **16/16** | `g1-recovery.log` |
| ⭐ 5 | `npm run test:unit` (round 2) | **559/559** | `g2-unit.log` |
| ⭐ 6 | `npm run test:integration` (round 2) | **146/147** · 1 skipped | `g2-integration.log` |
| ⭐ 7 | `npm run test:security` (round 2) | **105/105** | `g2-security.log` |
| ⭐ 8 | `npm run test:recovery` (round 2) | **16/16** | `g2-recovery.log` |

> ⭐⭐ **The two rounds are the point of M-82**: ⭐ the four groups run
> in PARALLEL, twice, with the SAME result ⇒ ⇒ ⇒ a file does not depend
> on the order of the files nor on a leftover row.
> ⭐⭐ **The isolation is by NAMESPACE, not by turning the parallelism
> off**: ⭐ every test file owns its companies ⇒ ⭐ and the ONE resource
> that cannot be namespaced (the platform login budget, D-070) is
> measured under a PostgreSQL advisory lock ⇒ ⭐ **the parallelism is
> never disabled**.

> ⭐⭐ **The tool that keeps the numbers true**:

```bash
# the structure: the partition is exact (no file counted twice)
python3 tools/test_count_audit.py

# + the numbers of a real run and the published documents
python3 tools/test_count_audit.py --log <run.log> --docs \
  --group-log unit=<u.log> --group-log integration=<i.log> \
  --group-log security=<s.log> --group-log recovery=<r.log>
```

### The measured results of PHASE 04 (BUILD 03) — ٧ نوفمبر ٢٠٢٦

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of the phase, before the first change | **827** · 826 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 1 | `npm test` | **874** · 873 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 2 | the four groups, two consecutive parallel rounds | **574 + 172 + 112 + 16 = 874** · identical in the two rounds | the run of the session |
| ⭐ 3 | `npm run e2e` | **JOURNEY OK** (15/15) | the run of the session |

### ⭐ The measured results of PHASE 04 bis (BUILD 03) — ٨ نوفمبر ٢٠٢٦

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of the phase, before the first change | **874** · 873 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 1 | `npm test` | **891** · 890 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 2 | `npm run test:unit` | **580/580** | the run of the session |
| ⭐ 3 | `npm run test:integration` | **182** · 181 pass · 0 fail · 1 skipped (the Docker drill) | the run of the session |
| ⭐ 4 | `npm run test:security` | **113/113** | the run of the session |
| ⭐ 5 | `npm run test:recovery` | **16/16** | the run of the session |
| ⭐ 6 | the four groups, two consecutive parallel rounds | **580 + 182 + 113 + 16 = 891** · identical in the two rounds | the run of the session |
| ⭐ 7 | `npm run e2e` | **JOURNEY OK** (15/15) | the run of the session |

> ⭐⭐ **The three defects that the measurement of this phase exposed**
> are part of the record on purpose: M97 (the trigger of the deletion
> evidence was disabled for the WHOLE table by another file ⇒ a false
> failure) · M98 (the administrative drill inherited the 15s statement
> timeout of a request ⇒ a false failure) · M99 (`pid % 400` is not
> injective over the live processes ⇒ `EADDRINUSE` ⇒ a false failure)
> ⇒ ⭐⭐ and all three were fixed with the M-82 pattern (a lock or a
> reservation on the shared resource itself) ⇒ ⭐⭐ **the parallelism
> was never disabled to hide them.**

### The measured results of round #54 (M109 · M110 · M111 · M112) — ٩ نوفمبر ۲۰۲۶

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of this round (round #53) | **923** · 922 pass · 0 fail · 1 skipped | the run of round #53 |
| ⭐ 1 | `npm test` | **933** · 932 pass · 0 fail · 1 skipped | `/workspace/r54-full.log` |
| ⭐ 2 | `npm run test:unit` | **587/587** | `/workspace/r54-g-unit-1.log` |
| ⭐ 3 | `npm run test:integration` | **203** · 202 pass · 0 fail · 1 skipped (the Docker drill) | `/workspace/r54-g-integration-1.log` |
| ⭐ 4 | `npm run test:security` | **127/127** | `/workspace/r54-g-security-1.log` |
| ⭐ 5 | `npm run test:recovery` | **16/16** | `/workspace/r54-g-recovery-1.log` |
| ⭐ 6 | the four groups, two consecutive parallel rounds | **587 + 203 + 127 + 16 = 933** · identical in the two rounds | `/workspace/r54-g-*-1.log` and `-2.log` |
| ⭐ 7 | `npm run e2e` | **JOURNEY OK** (15/15) | `/workspace/r54-e2e.log` |

> ⭐⭐ **Why 923 became 933 (and it is not a drift)**: the round
> added **10 permanent regression tests** (M109 · 5 · M110 · 4 · M112 ·
> +1 negative proof of the evidence guard) ⇒ ⇒ ⇒ **923 + 10 = 933**
> ⇒ ⇒ ⇒ and every one of them is a test that FAILS on the old code
> ⇒ ⇒ ⇒ so the number grew because the coverage grew, not because a
> file was counted twice.

> ⭐⭐⭐ **The files of the groups (M111 — the counts are derived from
> `package.json` by a tool, so they cannot drift)**: ⭐ **unit 24 ·
> integration 23 · security 13 · recovery 3** ⇒ ⭐ **63 files of
> `npm test`** ⇒ ⭐ **and the partition is a partition (no file is in
> two groups)**.

### The measured results of round #53 (M105 · M106 · M107 · M108) — ٩ نوفمبر ۲۰۲۶

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of this round (PHASE 04 bis 2) | **916** · 915 pass · 0 fail · 1 skipped | the run of PHASE 04 bis 2 |
| ⭐ 1 | `npm test` | **923** · 922 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 2 | `npm run test:unit` | **582/582** | the run of the session |
| ⭐ 3 | `npm run test:integration` | **198** · 197 pass · 0 fail · 1 skipped (the Docker drill) | the run of the session |
| ⭐ 4 | `npm run test:security` | **127/127** | the run of the session |
| ⭐ 5 | `npm run test:recovery` | **16/16** | the run of the session |
| ⭐ 6 | the four groups, two consecutive parallel rounds | **582 + 198 + 127 + 16 = 923** · identical in the two rounds | the run of the session |
| ⭐ 7 | `npm run e2e` | **JOURNEY OK** (15/15) | the run of the session |

> ⭐⭐ **Why 916 became 923 (and it is not a drift)**: the round
> added **7 permanent regression tests** (M105 · 4 · M106 · +2 rows of
> the rights matrix · M107 · +1 rule of the evidence guard) ⇒ ⇒ ⇒
> **916 + 7 = 923** ⇒ ⇒ ⇒ and every one of them is a test that FAILS
> on the old code ⇒ ⇒ ⇒ so the number grew because the coverage grew,
> not because a file was counted twice.

### The measured results of PHASE 04 bis 2 (BUILD 03) — ٨ نوفمبر ۲۰۲۶


| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of this round (PHASE 04 bis) | **891** · 890 pass · 0 fail · 1 skipped | the run of PHASE 04 bis |
| ⭐ 1 | `npm test` | **916** · 915 pass · 0 fail · 1 skipped | the run of the session |
| ⭐ 2 | `npm run test:unit` | **581/581** | the run of the session |
| ⭐ 3 | `npm run test:integration` | **194** · 193 pass · 0 fail · 1 skipped (the Docker drill) | the run of the session |
| ⭐ 4 | `npm run test:security` | **125/125** | the run of the session |
| ⭐ 5 | `npm run test:recovery` | **16/16** | the run of the session |
| ⭐ 6 | the four groups, two consecutive parallel rounds | **581 + 194 + 125 + 16 = 916** · identical in the two rounds | the run of the session |
| ⭐ 7 | `npm run e2e` | **JOURNEY OK** (15/15) | the run of the session |

> ⭐⭐ **Why 891 became 916 (and it is not a drift)**: the round
> added **24 permanent regression tests** (M100 · 6 + M101 · 6 +
> M102 · 6 + M104 · 6) and **one sub-test** inside the shared
> resource audit (the rule that forbids disabling the trigger outside a
> transaction) ⇒ ⇒ ⇒ **891 + 24 + 1 = 916** ⇒ ⇒ ⇒ and
> every one of the 24 is a test that FAILS on the old code ⇒ ⇒ ⇒ so
> the number grew because the coverage grew, not because a file was
> counted twice.

### The measured results of PHASE 02 (BUILD 03) — ٧ نوفمبر ٢٠٢٦

| # | Run | Result | Log |
|:-:|---|---|---|
| ⭐ 0 | the baseline of the phase, before the first change | **774** · 773 pass · 0 fail · 1 skipped | `/tmp/baseline-full.log` |
| ⭐ 1 | the first full run (after the new files) | **787** · 775 pass · **11 fail** · 1 skipped ⇒ **the interference of the files, analysed and fixed** | `/tmp/p2-full-first.log` |
| ⭐ 2 | `npm test` (after the isolation of the new files) | **812** · **811 pass** · **0 fail** · **1 skipped** | `/tmp/p2-full3.log` |
| ⭐ 3 | `npm run test:unit` | **559/559** | `/tmp/p2-unit.log` |
| ⭐ 4 | `npm run test:integration` | **136/137** · 1 skipped (the Docker drill) | `/tmp/p2-integration.log` |
| ⭐ 5 | `npm run test:security` | **100/100** | `/tmp/p2-security.log` |
| ⭐ 6 | `npm run test:recovery` | **16/16** | `/tmp/p2-recovery.log` |
| ⭐ 7 | `npm run test:server` | **174/174** | `/tmp/p2-server.log` |
| ⭐ 8 | `npm run e2e` | **JOURNEY OK** (15/15) | `/tmp/p2-e2e.log` |

> ⭐⭐ **The run #1 is kept in the record on purpose**: 11 failures that
> came from the SHARED fixtures and not from the product are part of
> the evidence of this phase ⇒ ⭐ **the fix is measured, not claimed**
> (run #2: 0 failures, the same code of the product).

> ⭐ Every number above was measured in the same session and comes from
> the log of the run that produced it. The full report is
> `docs/FOUNDATION-BUILD-02-PHASE-02-REPORT.md`.

> ⭐ **A note on the skipped test.** Without the privileged connection
> (`WASL_PG_SUPERUSER_URL`) the group `recovery` is **SKIPPED** and the
> run shows `# skipped 1`: the baseline without it was 685 tests / 684
> passed / 1 skipped. The skip is never hidden behind a success.


---

## 8. ⭐ The history of the phases (the measurements are NOT rewritten)

> ⭐⭐ **M96**: the current table of the groups is §1 and the history is
> HERE ⇒ ⇒ ⇒ a number of an old phase is never overwritten by the
> number of a new one ⇒ ⭐ and the history is the record of what was
> measured THEN (with the log that measured it).

### The measured partition of PHASE 03 (BUILD 03) — ٧ نوفمبر ٢٠٢٦

> ⭐⭐ **PHASE 03 (BUILD 03)**: the partition is checked by a TOOL
> (`tools/test_count_audit.py`) and the numbers are read from the LOG of
> a real run, never written by hand ⇒ now:
> **559 + 147 + 105 + 16 = 827** = the number of `npm test` exactly
> (146 of the 147 in `integration` pass and **1 is SKIPPED**: the
> dynamic Docker drill, see §6).
> ⭐⭐ **The tool fails when a published number is not the measured one**
> ⇒ ⇒ ⇒ a number can no longer drift silently.
