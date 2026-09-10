import pool from '../db.js';

/**
 * Create a new coupon.
 * @param {string} code
 * @param {'percent'|'flat'} discountType
 * @param {number} discountValue
 * @param {number} minSpend
 * @param {string} expiresAt - ISO date string
 * @param {number} usageLimit
 * @param {number|null} [maxDiscountAmount] - bonus 1: cap on computed discount for percent coupons
 * @param {number|null} [usageLimitPerUser] - bonus 2: per-user redemption cap
 * @returns {Promise<string>} a result message
 * @throws {Error} on invalid input or duplicate code
 */
export async function createCoupon(
  code,
  discountType,
  discountValue,
  minSpend,
  expiresAt,
  usageLimit,
  maxDiscountAmount = null,
  usageLimitPerUser = null
) {
  // Validate coupon code
  if (!code || !code.trim()) {
    throw new Error('Coupon code is required');
  }

  // Validate discount type
  if (!['percent', 'flat'].includes(discountType)) {
    throw new Error('Discount type must be percent or flat');
  }

  // Validate discount value
  if (!Number.isFinite(Number(discountValue)) || Number(discountValue) <= 0) {
    throw new Error('Discount value must be greater than 0');
  }

  // Validate minimum spend
  if (!Number.isFinite(Number(minSpend)) || Number(minSpend) < 0) {
    throw new Error('Minimum spend must be 0 or greater');
  }

  // Validate expiry date
  const expiry = new Date(expiresAt);

  if (Number.isNaN(expiry.getTime())) {
    throw new Error('Invalid expiry date');
  }

  // Validate global usage limit
  if (!Number.isFinite(Number(usageLimit)) || Number(usageLimit) <= 0) {
    throw new Error('Usage limit must be greater than 0');
  }

  // Validate bonus 1: maximum discount
  if (
    maxDiscountAmount !== null &&
    (!Number.isFinite(Number(maxDiscountAmount)) ||
      Number(maxDiscountAmount) <= 0)
  ) {
    throw new Error('Maximum discount amount must be greater than 0');
  }

  // Validate bonus 2: per-user usage limit
  if (
    usageLimitPerUser !== null &&
    (!Number.isFinite(Number(usageLimitPerUser)) ||
      Number(usageLimitPerUser) <= 0)
  ) {
    throw new Error('Per-user usage limit must be greater than 0');
  }

  // Maximum discount only makes sense for percentage coupons
  if (discountType === 'flat' && maxDiscountAmount !== null) {
    throw new Error(
      'Maximum discount amount can only be used with percent coupons'
    );
  }

  try {
    const result = await pool.query(
      `INSERT INTO coupons (
        code,
        discount_type,
        discount_value,
        min_spend,
        expires_at,
        usage_limit,
        max_discount_amount,
        usage_limit_per_user
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING code`,
      [
        code.trim(),
        discountType,
        Number(discountValue),
        Number(minSpend),
        expiry.toISOString(),
        Number(usageLimit),
        maxDiscountAmount === null ? null : Number(maxDiscountAmount),
        usageLimitPerUser === null ? null : Number(usageLimitPerUser),
      ]
    );

    return `Coupon ${result.rows[0].code} created successfully`;
  } catch (error) {
    // PostgreSQL unique constraint violation
    if (error.code === '23505') {
      throw new Error(`Coupon code '${code.trim()}' already exists`);
    }

    throw error;
  }
}