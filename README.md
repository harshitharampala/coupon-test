# Coupon Engine CLI – starter

See [`PROBLEM.md`](./PROBLEM.md) for the full spec, test cases, and acceptance criteria.

## Setup

```bash
docker compose up -d
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
## Implementation Notes

- Percentage coupons are applied before flat coupons when stacking.
- When stacking coupons, each coupon's minimum spend is checked against the current cart total before that coupon is applied.
- Coupon usage is updated inside database transactions with row locking to keep usage counts accurate during concurrent requests.
- Discounts and final totals are rounded to two decimal places, and the final total never goes below zero.