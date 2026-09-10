import pool from '../db.js';

/**
 * Get coupon details.
 * @param {string} code
 * @returns {Promise<object>} coupon details
 */
export async function getCoupon(code) {
  if (!code || !code.trim()) {
    throw new Error('Coupon code is required');
  }

  const result = await pool.query(
    `SELECT
      code,
      discount_type,
      discount_value,
      min_spend,
      expires_at,
      usage_limit,
      times_used,
      max_discount_amount,
      usage_limit_per_user
    FROM coupons
    WHERE code = $1`,
    [code.trim()]
  );

  if (result.rows.length === 0) {
    throw new Error(`Coupon '${code.trim()}' not found`);
  }

  const coupon = result.rows[0];

  return {
    code: coupon.code,
    discountType: coupon.discount_type,
    discountValue: Number(coupon.discount_value),
    minSpend: Number(coupon.min_spend),
    expiresAt: coupon.expires_at.toISOString(),
    usageLimit: Number(coupon.usage_limit),
    timesUsed: Number(coupon.times_used),
    maxDiscountAmount:
      coupon.max_discount_amount === null
        ? null
        : Number(coupon.max_discount_amount),
    usageLimitPerUser:
      coupon.usage_limit_per_user === null
        ? null
        : Number(coupon.usage_limit_per_user),
  };
}