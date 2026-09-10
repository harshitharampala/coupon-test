import pool from '../db.js';

/**
 * Cancel an order and release coupon usage.
 * @param {string} orderId
 * @returns {Promise<string>}
 */
export async function cancelOrder(orderId) {
  if (!orderId || !orderId.trim()) {
    throw new Error('Order ID is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Lock the order so it cannot be cancelled twice at the same time.
    const orderResult = await client.query(
      `SELECT id, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId.trim()]
    );

    if (orderResult.rows.length === 0) {
      throw new Error(`Order '${orderId.trim()}' not found`);
    }

    const order = orderResult.rows[0];

    if (order.status === 'cancelled') {
      throw new Error(`Order '${orderId.trim()}' is already cancelled`);
    }

    // Find all coupons used by this order.
    const couponResult = await client.query(
      `SELECT code
       FROM order_coupons
       WHERE order_id = $1
       ORDER BY code`,
      [orderId.trim()]
    );

    // Lock and release each coupon usage.
    for (const row of couponResult.rows) {
      await client.query(
        `SELECT code
         FROM coupons
         WHERE code = $1
         FOR UPDATE`,
        [row.code]
      );

      await client.query(
        `UPDATE coupons
         SET times_used = times_used - 1
         WHERE code = $1
           AND times_used > 0`,
        [row.code]
      );
    }

    // Change order status to cancelled.
    await client.query(
      `UPDATE orders
       SET status = 'cancelled'
       WHERE id = $1`,
      [orderId.trim()]
    );

    await client.query('COMMIT');

    return `Order ${orderId.trim()} cancelled successfully`;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}