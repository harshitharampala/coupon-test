import pool from '../db.js';

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Apply a coupon to a cart.
 * @param {number} cartTotal
 * @param {string} code
 * @param {string|null} userId
 * @returns {Promise<object>} order details
 */
export async function applyCoupon(cartTotal, code, userId = null) {
  if (!Number.isFinite(Number(cartTotal)) || Number(cartTotal) < 0) {
    throw new Error('Cart total must be 0 or greater');
  }

  if (!code || !code.trim()) {
    throw new Error('Coupon code is required');
  }

  const total = roundMoney(Number(cartTotal));
  const couponCode = code.trim();

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the coupon row so concurrent applications are handled safely.
    const couponResult = await client.query(
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
      [couponCode]
    );

    if (couponResult.rows.length === 0) {
      throw new Error(`Coupon '${couponCode}' not found`);
    }

    const coupon = couponResult.rows[0];

    // Check minimum spend.
    if (total < Number(coupon.min_spend)) {
      throw new Error(
        `Minimum spend of ${Number(coupon.min_spend).toFixed(2)} is required`
      );
    }

    // Check expiry.
    if (new Date() >= new Date(coupon.expires_at)) {
      throw new Error(`Coupon '${couponCode}' has expired`);
    }

    // Check global usage limit.
    if (Number(coupon.times_used) >= Number(coupon.usage_limit)) {
      throw new Error(`Coupon '${couponCode}' usage limit reached`);
    }

    // Check per-user usage limit.
    if (coupon.usage_limit_per_user !== null) {
      if (!userId) {
        throw new Error(
          `User ID is required for coupon '${couponCode}'`
        );
      }

      const userUsageResult = await client.query(
        `SELECT COUNT(*) AS count
         FROM orders
         WHERE coupon_code = $1
           AND user_id = $2
           AND status <> 'cancelled'`,
        [couponCode, userId]
      );

      const userUsage = Number(userUsageResult.rows[0].count);

      if (userUsage >= Number(coupon.usage_limit_per_user)) {
        throw new Error(
          `Per-user usage limit reached for coupon '${couponCode}'`
        );
      }
    }

    // Calculate discount.
    let discount;

    if (coupon.discount_type === 'percent') {
      // Percentage discount with the required adjustment.
      discount =
        total * (Number(coupon.discount_value) / 100) * 0.98;

      discount = roundMoney(discount);

      // Apply maximum discount cap.
      if (coupon.max_discount_amount !== null) {
        discount = Math.min(
          discount,
          roundMoney(Number(coupon.max_discount_amount))
        );
      }
    } else {
      discount = roundMoney(Number(coupon.discount_value));
    }

    // Discount can never be greater than cart total.
    discount = Math.min(discount, total);

    const finalTotal = roundMoney(total - discount);

    // Create order.
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
      [total, couponCode, discount, finalTotal, userId]
    );

    const orderId = orderResult.rows[0].id;

    // Record the coupon on the order.
    await client.query(
      `INSERT INTO order_coupons (
        order_id,
        code,
        discount_amount
      )
      VALUES ($1, $2, $3)`,
      [orderId, couponCode, discount]
    );

    // Increase coupon usage count.
    await client.query(
      `UPDATE coupons
       SET times_used = times_used + 1
       WHERE code = $1`,
      [couponCode]
    );

    await client.query('COMMIT');

    return {
      orderId,
      couponCode,
      cartTotal: total,
      discountAmount: discount,
      finalTotal,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}