# Future Improvements

Technical debt and shortcuts taken during MVP implementations. Each item documents what was implemented vs. what an ideal solution would look like.

---

## Portfolio Composition & Probability of Success (2026-03-29)

### 1. Hardcoded Ticker Mapping

**Current:** ~90 tickers manually mapped to asset classes/sub-categories in `packages/core/src/ticker-categories.ts`

**Shortcut taken:**
- Static mapping requires manual updates when new funds launch
- Missing tickers fall back to "Other" category
- No coverage for individual stocks (AAPL, GOOGL, etc.)

**Ideal solution:**
- API integration (e.g., Morningstar, Alpha Vantage, or Financial Modeling Prep) to dynamically fetch:
  - Asset class classification
  - Sector breakdown
  - Style box (growth/value, large/mid/small cap)
- Allow users to override/customize mappings
- Auto-detect asset class from security metadata

**Estimated effort:** Medium (API integration + caching layer)

---

### 2. Static Historical Returns Data

**Current:** Embedded JSON file with annual returns from 1928-2024 in `packages/api/data/historical-returns.json`

**Shortcut taken:**
- Data is manually curated from NYU Stern Damodaran Excel files
- Requires manual updates each year
- International stocks data only from 1970, REITs from 1972 (missing early years)
- No monthly/daily granularity

**Ideal solution:**
- Real-time data feed integration (Yahoo Finance API, Alpha Vantage, FRED)
- Monthly returns for more granular backtesting
- Automatic annual data refresh
- Multiple data sources for validation
- Dividend reinvestment accuracy

**Estimated effort:** Medium-High (API subscription costs + data pipeline)

---

### 3. Simplified Asset Class Return Models

**Current:** Fixed mean/stdDev values for Monte Carlo:
- US Stocks: 10% mean, 18% stdDev
- Intl Stocks: 8% mean, 20% stdDev
- Bonds: 5% mean, 7% stdDev
- REITs: 9% mean, 22% stdDev
- Cash: 2% mean, 1% stdDev

**Shortcut taken:**
- Models don't account for:
  - Correlation between asset classes
  - Regime changes (bull/bear markets)
  - Mean reversion
  - Fat tails / non-normal distributions
  - Interest rate environment impact

**Ideal solution:**
- Covariance matrix for correlated asset returns
- GARCH or regime-switching models
- Bootstrap from historical data instead of parametric assumptions
- User-adjustable return assumptions
- Scenario testing (1970s inflation, 2008 crash, etc.)

**Estimated effort:** High (statistical modeling expertise required)

---

### 4. No Inflation Series in Backtests

**Current:** Backtests use a fixed inflation assumption

**Shortcut taken:**
- Real historical inflation varies significantly (negative in 1930s, 13%+ in 1980)
- Withdrawal amounts not properly inflation-adjusted to historical periods

**Ideal solution:**
- Use actual CPI data for each backtest year
- Properly simulate purchasing power preservation

**Estimated effort:** Low (data exists in Damodaran dataset)

---

### 5. Holdings Snapshot Deduplication

**Current:** Simple "most recent snapshot per holding" logic

**Shortcut taken:**
- No handling for:
  - Holdings that were sold (still show up if last snapshot exists)
  - Time-series analysis of holdings changes
  - Proper handling of corporate actions (splits, mergers)

**Ideal solution:**
- Track holding lifecycle (bought → held → sold)
- Support point-in-time queries ("what was my portfolio on X date?")
- Handle corporate actions from Plaid data

**Estimated effort:** Medium

---

### 6. No Tax Lot Information

**Current:** Simple cost basis tracking

**Shortcut taken:**
- No specific lot identification
- Can't calculate short-term vs long-term gains
- No tax-loss harvesting optimization

**Ideal solution:**
- Track individual purchase lots
- FIFO/LIFO/Specific ID accounting methods
- Integrate with tax planning features

**Estimated effort:** High (significant schema changes)

---

### 7. Fixed Withdrawal Rate Model

**Current:** Single withdrawal rate applied uniformly

**Shortcut taken:**
- Real retirement often has:
  - Variable spending (higher early, lower late)
  - Social Security income starting mid-retirement
  - Required Minimum Distributions
  - Health care cost spikes

**Ideal solution:**
- Multi-phase retirement modeling
- Income source integration (SS, pensions)
- Variable spending patterns
- Healthcare cost modeling

**Estimated effort:** High (significant feature expansion)

---

### 8. No Real-Time Price Updates

**Current:** Uses Plaid-provided values at sync time

**Shortcut taken:**
- Portfolio values can be stale (hours to days old)
- Intraday changes not reflected

**Ideal solution:**
- Real-time quote API integration
- WebSocket updates for live dashboard
- Price alerts and notifications

**Estimated effort:** Medium (API costs + real-time infrastructure)

---

## How to Use This Document

When implementing improvements:
1. Reference this document to understand the full scope of the shortcut
2. Update this document when the improvement is made
3. Add new shortcuts as they're taken in future features

When prioritizing:
- **Low effort + High impact:** Do these first
- **High effort + High impact:** Plan for these in major versions
- **Low impact:** Consider if they're worth doing at all
