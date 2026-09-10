import pool from '../db.js';

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Apply 1 or 2 coupons to a cart.
 *
 * Stacking order:
 * 1. Percentage coupon
 * 2. Flat coupon
 *
 * @param {number} cartTotal
 * @param {string[]} codes
 * @param {string|null} userId
 * @returns {Promise<object>}
 */
export async function applyCoupons(cartTotal, codes, userId = null) {
  if (!Number.isFinite(Number(cartTotal)) || Number(cartTotal) < 0) {
    throw new Error('Cart total must be 0 or greater');
  }

  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 2) {
    throw new Error('Provide 1 or 2 coupon codes');
  }

  const couponCodes = codes.map((code) => code.trim());

  if (couponCodes.some((code) => !code)) {
    throw new Error('Coupon code is required');
  }

  if (new Set(couponCodes).size !== couponCodes.length) {
    throw new Error('The same coupon cannot be used twice');
  }

  const total = roundMoney(Number(cartTotal));
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock coupons in a fixed order for concurrency safety.
    const sortedCodes = [...couponCodes].sort();

    const couponMap = new Map();

    for (const code of sortedCodes) {
      const result = await client.query(
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
        WHERE code = $1
        FOR UPDATE`,
        [code]
      );

      if (result.rows.length === 0) {
        throw new Error(`Coupon '${code}' not found`);
      }

      couponMap.set(code, result.rows[0]);
    }

    const coupons = couponCodes.map((code) => couponMap.get(code));

    // Only one percentage and one flat coupon are allowed.
    const percentCoupons = coupons.filter(
      (coupon) => coupon.discount_type === 'percent'
    );

    const flatCoupons = coupons.filter(
      (coupon) => coupon.discount_type === 'flat'
    );

    if (percentCoupons.length > 1) {
      throw new Error('Cannot stack two percent coupons');
    }

    if (flatCoupons.length > 1) {
      throw new Error('Cannot stack two flat coupons');
    }

    // Apply percentage coupon first, then flat coupon.
    const orderedCoupons = [
      ...percentCoupons,
      ...flatCoupons,
    ];

    let currentTotal = total;
    let totalDiscount = 0;
    const appliedDiscounts = [];

    for (const coupon of orderedCoupons) {
      // Minimum spend is checked against the current total.
      if (currentTotal < Number(coupon.min_spend)) {
        throw new Error(
          `Minimum spend of ${Number(coupon.min_spend).toFixed(2)} is required for coupon '${coupon.code}'`
        );
      }

      // Check expiry.
      if (new Date() >= new Date(coupon.expires_at)) {
        throw new Error(`Coupon '${coupon.code}' has expired`);
      }

      // Check global usage.
      if (Number(coupon.times_used) >= Number(coupon.usage_limit)) {
        throw new Error(`Coupon '${coupon.code}' usage limit reached`);
      }

      // Check per-user usage.
      if (coupon.usage_limit_per_user !== null) {
        if (!userId) {
          throw new Error(
            `User ID is required for coupon '${coupon.code}'`
          );
        }

        const userUsageResult = await client.query(
          `SELECT COUNT(*) AS count
           FROM orders
           WHERE coupon_code = $1
             AND user_id = $2
             AND status <> 'cancelled'`,
          [coupon.code, userId]
        );

        const userUsage = Number(userUsageResult.rows[0].count);

        if (userUsage >= Number(coupon.usage_limit_per_user)) {
          throw new Error(
            `Per-user usage limit reached for coupon '${coupon.code}'`
          );
        }
      }

      let discount;

      if (coupon.discount_type === 'percent') {
        discount =
          currentTotal *
          (Number(coupon.discount_value) / 100) *
          0.98;

        discount = roundMoney(discount);

        if (coupon.max_discount_amount !== null) {
          discount = Math.min(
            discount,
            roundMoney(Number(coupon.max_discount_amount))
          );
        }
      } else {
        discount = roundMoney(Number(coupon.discount_value));
      }

      discount = Math.min(discount, currentTotal);
      discount = roundMoney(discount);

      currentTotal = roundMoney(currentTotal - discount);
      totalDiscount = roundMoney(totalDiscount + discount);

      appliedDiscounts.push({
        code: coupon.code,
        discountAmount: discount,
      });
    }

    const finalTotal = roundMoney(currentTotal);

    // Store the order.
    const orderResult = await client.query(
      `INSERT INTO orders (
        cart_total,
        coupon_code,
        discount_amount,
        final_total,
        status,
        user_id
      )
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING id`,
      [
        total,
        couponCodes[0],
        totalDiscount,
        finalTotal,
        userId,
      ]
    );

    const orderId = orderResult.rows[0].id;

    // Record every coupon used by the order.
    for (const applied of appliedDiscounts) {
      await client.query(
        `INSERT INTO order_coupons (
          order_id,
          code,
          discount_amount
        )
        VALUES ($1, $2, $3)`,
        [
          orderId,
          applied.code,
          applied.discountAmount,
        ]
      );

      await client.query(
        `UPDATE coupons
         SET times_used = times_used + 1
         WHERE code = $1`,
        [applied.code]
      );
    }

    await client.query('COMMIT');

    return {
      orderId,
      couponCodes: orderedCoupons.map((coupon) => coupon.code),
      cartTotal: total,
      discountAmount: totalDiscount,
      finalTotal,
      discounts: appliedDiscounts,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}