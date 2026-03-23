# Dynamic Seed Data Generator

## Overview

Refactor the database seed script to support multiple net worth profiles with configurable asset compositions. Creates separate timestamped users for each profile.

## Schema Changes

### New Account Types
Add to `account_type` enum:
- `real_estate` - primary residence, rental properties
- `alternative` - PE, hedge funds, crypto, angel investments

### New Account Column
Add `metadata` (text/JSON) to `accounts` table for loan-specific data:
```json
{"interestRate": 6.75, "termMonths": 360, "originationDate": "2023-01-15"}
```

## File Structure

```
packages/core/src/seed/
├── index.ts           # CLI entry point, arg parsing
├── types.ts           # SeedConfig, AssetConfig, etc.
├── presets.ts         # 9 preset definitions
├── generators/
│   ├── base.ts        # Creates tenant, user, plaid item
│   ├── assets.ts      # cash, savings, 401k, ira, brokerage, hsa, 529, crypto, cd, money_market
│   ├── property.ts    # primary residence, rental properties
│   ├── alternatives.ts # PE, hedge funds, angel investments
│   └── loans.ts       # car, mortgage with interest rates
└── utils.ts           # parseAmount, random variance
```

## CLI Interface

```bash
# Presets
pnpm db:seed --preset=negative
pnpm db:seed --preset=100k
pnpm db:seed --preset=750k
pnpm db:seed --preset=1.8M
pnpm db:seed --preset=4M
pnpm db:seed --preset=7M
pnpm db:seed --preset=12M
pnpm db:seed --preset=25M
pnpm db:seed --preset=75M

# Explicit values
pnpm db:seed \
  --assets="cash:50k,roth_401k:100k,brokerage:3M" \
  --property="primary:750k,rental1:450k" \
  --alternatives="pe:500k" \
  --loans="primary_mortgage:500k@6.25,car:25k"

# Preset with overrides
pnpm db:seed --preset=1.8M --assets="crypto:100k"

# Multiple users
pnpm db:seed --preset=negative --preset=75M
```

Output: JSON credentials for each user created.

## Presets

| Preset | Net Worth | Composition |
|--------|-----------|-------------|
| `negative` | -$50k | cash:2k, credit_card:8k, student_loan:40k, car_loan:12k |
| `100k` | ~$100k | cash:15k, savings:25k, trad_401k:50k, brokerage:15k, credit_card:3k, car_loan:5k |
| `750k` | ~$750k | cash:30k, savings:50k, roth_401k:150k, trad_401k:200k, brokerage:250k, hsa:20k, primary:450k, primary_mortgage:400k |
| `1.8M` | ~$1.8M | cash:50k, savings:100k, retirement:500k, brokerage:600k, primary:800k, rental1:400k, mortgages:650k |
| `4M` | ~$4M | cash:100k, savings:200k, retirement:800k, brokerage:1.5M, primary:1.2M, rental:600k, pe:300k, mortgages:700k |
| `7M` | ~$7M | cash:150k, retirement:1M, brokerage:2.5M, primary:2M, rentals:1.5M, alternatives:800k, mortgages:950k |
| `12M` | ~$12M | cash:250k, retirement:1.5M, brokerage:4M, properties:4M, alternatives:2M, mortgages:750k |
| `25M` | ~$25M | cash:500k, retirement:2M, brokerage:8M, properties:8M, alternatives:6M, mortgages:500k |
| `75M` | ~$75M | cash:1M, retirement:3M, brokerage:25M, properties:20M, alternatives:25M, mortgages:1M |

## Default Interest Rates

| Loan Type | Default APR |
|-----------|-------------|
| credit_card | 24.99% |
| student_loan | 6.5% |
| car_loan | 7.5% |
| primary_mortgage | 6.75% |
| rental_mortgage | 7.25% |

Override via: `--loans="car:25k@5.9"`

## Asset Categories

### --assets
cash, savings, roth_401k, trad_401k, roth_ira, trad_ira, brokerage, hsa, 529, crypto, cd, money_market

### --property
primary, rental1, rental2, rental3, ...

### --alternatives
pe, hedge, angel, crypto_alt

### --loans
credit_card, student_loan, car, primary_mortgage, rental1_mortgage, rental2_mortgage, ...

## Investment Holdings

For investment accounts, generator creates securities and holdings:
- Pool of ~20 realistic securities (AAPL, MSFT, VTI, VXUS, BND, etc.)
- Retirement: heavier on index funds
- Brokerage: mix of individual stocks + ETFs
- Random variance (±5%) on quantities

## Migration Notes

- Remove E2E_SEED mode distinction
- All seeds create timestamped users
- Always output JSON credentials
- Old seed.ts replaced by seed/ module
