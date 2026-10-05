# ADR 0002 — Double-entry ledger in integer micro-dollars

**Status:** accepted

## Context

The spec suggests `balance DECIMAL(12,2)` on users and a free-form transactions table. Rewarded videos pay fractions
of a cent, members cash out tiny amounts, networks reverse conversions days later, and trust collapses the first time
a balance is wrong.

## Decision

- Store every amount as an integer number of **micro-dollars** (`bigint`).
- Model money as a **double-entry ledger** (`ledger_accounts`, `ledger_transactions`, `ledger_entries`): every
  movement is a balanced transaction with a globally unique idempotency key.
- Cache balances on account rows, updated in the same DB transaction as the entries, with accounts locked in id order.
- `CHECK (allow_negative OR balance >= 0)` on accounts: member balances and payout clearing can never go negative.

## Consequences

- Retries (network postbacks, client double-submits, worker restarts) can never double-pay.
- Platform economics (revenue, bonuses, goodwill, absorbed reversals, money owed) fall out of account balances and
  power the admin analytics directly.
- Tests assert Σdebits = Σcredits and cached balances = entries after every scenario.
