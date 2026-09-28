import { Router, type Request, type Response, type Router as RouterType } from 'express';
import crypto from 'crypto';

export const checkoutRouter: RouterType = Router();

const WAREHOUSE_ID = process.env.SQL_WAREHOUSE_ID || '';
const WORKSPACE_URL = process.env.DATABRICKS_HOST || '';

// IMPORTANT: this must match the DEFAULT_CUSTOMER_ID constant used by the
// Python Transaction Agent, so the chat flow and this click-through flow
// operate on the same customer's cart/orders.
const CUSTOMER_ID = process.env.DEFAULT_CUSTOMER_ID || 'CUST_DEMO_001';

function shortId(prefix: string, len = 8): string {
  return prefix + crypto.randomBytes(len).toString('hex').slice(0, len).toUpperCase();
}

function getToken(req: Request): string | null {
  return (req.headers['x-forwarded-access-token'] as string) || null;
}

async function runSql(token: string, statement: string): Promise<any[]> {
  const response = await fetch(`${WORKSPACE_URL}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      warehouse_id: WAREHOUSE_ID,
      statement,
      wait_timeout: '30s',
    }),
  });

  const data = await response.json();

  if (data.error || data.status?.state === 'FAILED') {
    throw new Error(
      data.status?.error?.message || data.error?.message || 'SQL statement failed',
    );
  }

  return data.result?.data_array || [];
}

function esc(value: string): string {
  return String(value).replace(/'/g, "''");
}

// ============================================================
// ADDRESSES
// ============================================================

checkoutRouter.get('/addresses', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  try {
    const rows = await runSql(
      token,
      `SELECT address_id, city, state, is_default
       FROM ap2_ecommerce.gold.customer_addresses
       WHERE customer_id = '${esc(CUSTOMER_ID)}'
       ORDER BY created_at DESC`,
    );

    const addresses = rows.map((r) => ({
      address_id: r[0],
      city: r[1],
      state: r[2],
      is_default: !!r[3],
    }));

    res.json(addresses);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

checkoutRouter.post('/addresses', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { city, state } = req.body;

  if (!city || !state) {
    return res.status(400).json({ error: 'City and state are required.' });
  }

  const addressId = shortId('ADDR');

  try {
    await runSql(
      token,
      `INSERT INTO ap2_ecommerce.gold.customer_addresses
       (address_id, customer_id, city, state, is_default, created_at)
       VALUES (
         '${addressId}',
         '${esc(CUSTOMER_ID)}',
         '${esc(city)}',
         '${esc(state)}',
         false,
         current_timestamp()
       )`,
    );

    res.json({ address_id: addressId, city, state, is_default: false });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

checkoutRouter.post('/cart/add', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { product_id, quantity, price } = req.body;

  if (!product_id || !quantity || price === undefined) {
    return res.status(400).json({ error: 'product_id, quantity, and price are required.' });
  }

  try {
    const existingCartRows = await runSql(
      token,
      `SELECT cart_id FROM ap2_ecommerce.gold.carts
       WHERE customer_id = '${esc(CUSTOMER_ID)}'
         AND status = 'PENDING_CONFIRMATION'
       LIMIT 1`,
    );

    const cartId = existingCartRows.length > 0 ? existingCartRows[0][0] : shortId('CART');

    const existingProductRows = await runSql(
      token,
      `SELECT quantity FROM ap2_ecommerce.gold.carts
       WHERE cart_id = '${esc(cartId)}' AND product_id = '${esc(product_id)}'
       LIMIT 1`,
    );

    if (existingProductRows.length > 0) {
      const newQuantity = Number(existingProductRows[0][0]) + Number(quantity);

      await runSql(
        token,
        `UPDATE ap2_ecommerce.gold.carts
         SET quantity = ${newQuantity}
         WHERE cart_id = '${esc(cartId)}' AND product_id = '${esc(product_id)}'`,
      );
    } else {
      await runSql(
        token,
        `INSERT INTO ap2_ecommerce.gold.carts
         (cart_id, customer_id, product_id, quantity, price, status, created_at)
         VALUES (
           '${esc(cartId)}',
           '${esc(CUSTOMER_ID)}',
           '${esc(product_id)}',
           ${Number(quantity)},
           ${Number(price)},
           'PENDING_CONFIRMATION',
           current_timestamp()
         )`,
      );
    }

    res.json({ status: 'success', cart_id: cartId });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ============================================================
// CART
// ============================================================

checkoutRouter.get('/cart', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  try {
    const cartRows = await runSql(
      token,
      `SELECT cart_id, status, delivery_address
       FROM ap2_ecommerce.gold.carts
       WHERE customer_id = '${esc(CUSTOMER_ID)}'
         AND status IN ('PENDING_CONFIRMATION', 'CONFIRMED')
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    if (cartRows.length === 0) {
      return res.json({ cart_id: null, status: null, items: [], total: 0, delivery_address: null });
    }

    const [cartId, status, deliveryAddress] = cartRows[0];

    const itemRows = await runSql(
      token,
      `SELECT c.product_id, p.product_name, p.image_url, c.quantity, c.price
       FROM ap2_ecommerce.gold.carts c
       LEFT JOIN ap2_ecommerce.gold.product_catalog p
         ON c.product_id = p.product_id
       WHERE c.cart_id = '${esc(cartId)}'`,
    );

    const items = itemRows.map((r) => ({
      product_id: r[0],
      product_name: r[1] || 'Product',
      image_url: r[2] || '',
      quantity: Number(r[3]),
      price: Number(r[4]),
    }));

    const total = items.reduce((sum, it) => sum + it.price * it.quantity, 0);

    res.json({ cart_id: cartId, status, items, total, delivery_address: deliveryAddress });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

checkoutRouter.post('/cart/remove', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { cart_id, product_id } = req.body;

  if (!cart_id || !product_id) {
    return res.status(400).json({ error: 'cart_id and product_id are required.' });
  }

  try {
    await runSql(
      token,
      `DELETE FROM ap2_ecommerce.gold.carts
       WHERE cart_id = '${esc(cart_id)}'
         AND product_id = '${esc(product_id)}'
         AND status = 'PENDING_CONFIRMATION'`,
    );

    res.json({ status: 'removed' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

checkoutRouter.post('/cart/confirm', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { cart_id, address_id } = req.body;

  if (!cart_id || !address_id) {
    return res.status(400).json({ error: 'cart_id and address_id are required.' });
  }

  try {
    const addressRows = await runSql(
      token,
      `SELECT city, state FROM ap2_ecommerce.gold.customer_addresses
       WHERE address_id = '${esc(address_id)}'
         AND customer_id = '${esc(CUSTOMER_ID)}'
       LIMIT 1`,
    );

    if (addressRows.length === 0) {
      return res.status(404).json({ error: 'Address not found.' });
    }

    const [city, state] = addressRows[0];
    const deliveryLocation = `${city}, ${state}`;

    await runSql(
      token,
      `UPDATE ap2_ecommerce.gold.carts
       SET status = 'CONFIRMED',
           delivery_address = '${esc(deliveryLocation)}'
       WHERE cart_id = '${esc(cart_id)}'`,
    );

    res.json({ status: 'confirmed', cart_id, delivery_address: deliveryLocation });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ============================================================
// PAYMENT (simulated gateway - demo mode, matches Python agent)
// ============================================================

checkoutRouter.post('/pay', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { cart_id, payment_type } = req.body;

  if (!cart_id || !payment_type) {
    return res.status(400).json({ error: 'cart_id and payment_type are required.' });
  }

  try {
    const totalRows = await runSql(
      token,
      `SELECT COALESCE(SUM(price * quantity), 0)
       FROM ap2_ecommerce.gold.carts
       WHERE cart_id = '${esc(cart_id)}'`,
    );

    const amount = Number(totalRows[0]?.[0] || 0);

    if (amount <= 0) {
      return res.status(400).json({ error: 'Cart is empty.' });
    }

    const mandateId = shortId('MANDATE');
    const txnId =
      payment_type === 'cod' ? shortId('COD') : shortId('TXNSIM', 10);

    await runSql(
      token,
      `INSERT INTO ap2_ecommerce.gold.payment_mandates
       (mandate_id, cart_id, customer_id, amount, payment_type, status, txn_id, created_at, confirmed_at)
       VALUES (
         '${mandateId}',
         '${esc(cart_id)}',
         '${esc(CUSTOMER_ID)}',
         ${amount},
         '${esc(payment_type)}',
         'SUCCESS',
         '${txnId}',
         current_timestamp(),
         current_timestamp()
       )`,
    );

    res.json({
      status: 'SUCCESS',
      mandate_id: mandateId,
      amount,
      payment_type,
      txn_id: txnId,
      processed_at: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ============================================================
// ORDER CREATION
// ============================================================

checkoutRouter.post('/order', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { cart_id } = req.body;

  if (!cart_id) {
    return res.status(400).json({ error: 'cart_id is required.' });
  }

  try {
    const paymentRows = await runSql(
      token,
      `SELECT mandate_id, txn_id, amount, payment_type
       FROM ap2_ecommerce.gold.payment_mandates
       WHERE cart_id = '${esc(cart_id)}'
         AND customer_id = '${esc(CUSTOMER_ID)}'
         AND status = 'SUCCESS'
       ORDER BY created_at DESC
       LIMIT 1`,
    );

    if (paymentRows.length === 0) {
      return res.status(400).json({ error: 'No successful payment found for this cart.' });
    }

    const [mandateId, txnId, amount, paymentType] = paymentRows[0];

    const existingOrderRows = await runSql(
      token,
      `SELECT order_id FROM ap2_ecommerce.gold.orders WHERE cart_id = '${esc(cart_id)}' LIMIT 1`,
    );

    if (existingOrderRows.length > 0) {
      return res.json({ order_id: existingOrderRows[0][0], status: 'already_exists' });
    }

    const cartRows = await runSql(
      token,
      `SELECT delivery_address FROM ap2_ecommerce.gold.carts WHERE cart_id = '${esc(cart_id)}' LIMIT 1`,
    );

    const deliveryAddress = cartRows[0]?.[0] || '';

    const itemRows = await runSql(
      token,
      `SELECT c.product_id, p.product_name, p.image_url, c.quantity
       FROM ap2_ecommerce.gold.carts c
       LEFT JOIN ap2_ecommerce.gold.product_catalog p ON c.product_id = p.product_id
       WHERE c.cart_id = '${esc(cart_id)}'`,
    );

    const orderId = shortId('ORDER');
    const trackingId = shortId('TRK', 10);

    await runSql(
      token,
      `INSERT INTO ap2_ecommerce.gold.orders
       (order_id, cart_id, customer_id, mandate_id, txn_id, amount, status, created_at)
       VALUES (
         '${orderId}',
         '${esc(cart_id)}',
         '${esc(CUSTOMER_ID)}',
         '${esc(mandateId)}',
         '${esc(txnId)}',
         ${Number(amount)},
         'created',
         current_timestamp()
       )`,
    );

    await runSql(
      token,
      `INSERT INTO ap2_ecommerce.gold.deliveries
       (order_id, tracking_id, carrier, delivery_status, estimated_delivery_date, shipped_date, updated_at)
       VALUES (
         '${orderId}',
         '${trackingId}',
         'AP2 Express',
         'Shipped',
         DATE_ADD(CURRENT_DATE(), 3),
         CURRENT_DATE(),
         CURRENT_TIMESTAMP()
       )`,
    );

    await runSql(
      token,
      `UPDATE ap2_ecommerce.gold.carts SET status = 'ORDERED' WHERE cart_id = '${esc(cart_id)}'`,
    );

    res.json({
      order_id: orderId,
      cart_id,
      status: 'created',
      amount: Number(amount),
      payment_type: paymentType,
      txn_id: txnId,
      delivery_address: deliveryAddress,
      tracking_id: trackingId,
      items: itemRows.map((r) => ({
        product_id: r[0],
        product_name: r[1] || 'Product',
        image_url: r[2] || '',
        quantity: Number(r[3]),
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// ============================================================
// ORDER HISTORY
// ============================================================

checkoutRouter.get('/orders', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  try {
    const rows = await runSql(
      token,
      `SELECT order_id, amount, status, created_at, cart_id
       FROM ap2_ecommerce.gold.orders
       WHERE customer_id = '${esc(CUSTOMER_ID)}'
       ORDER BY created_at DESC`,
    );

    const orders = rows.map((r) => ({
      order_id: r[0],
      amount: Number(r[1]),
      status: r[2],
      created_at: r[3],
      cart_id: r[4],
    }));

    res.json(orders);
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

checkoutRouter.get('/orders/:orderId', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });

  const { orderId } = req.params;

  try {
    const orderRows = await runSql(
      token,
      `SELECT order_id, cart_id, amount, status, created_at, txn_id, mandate_id
       FROM ap2_ecommerce.gold.orders
       WHERE order_id = '${esc(orderId)}'
       LIMIT 1`,
    );

    if (orderRows.length === 0) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const [oid, cartId, amount, status, createdAt, txnId, mandateId] = orderRows[0];

    const paymentRows = await runSql(
      token,
      `SELECT payment_type FROM ap2_ecommerce.gold.payment_mandates WHERE mandate_id = '${esc(mandateId)}' LIMIT 1`,
    );

    const cartRows = await runSql(
      token,
      `SELECT delivery_address FROM ap2_ecommerce.gold.carts WHERE cart_id = '${esc(cartId)}' LIMIT 1`,
    );

    const itemRows = await runSql(
      token,
      `SELECT c.product_id, p.product_name, p.image_url, c.quantity, c.price
       FROM ap2_ecommerce.gold.carts c
       LEFT JOIN ap2_ecommerce.gold.product_catalog p ON c.product_id = p.product_id
       WHERE c.cart_id = '${esc(cartId)}'`,
    );

    const deliveryRows = await runSql(
      token,
      `SELECT tracking_id, carrier, delivery_status, estimated_delivery_date, shipped_date
       FROM ap2_ecommerce.gold.deliveries
       WHERE order_id = '${esc(oid)}'
       ORDER BY updated_at DESC
       LIMIT 1`,
    );

    res.json({
      order_id: oid,
      amount: Number(amount),
      status,
      created_at: createdAt,
      txn_id: txnId,
      payment_type: paymentRows[0]?.[0] || null,
      delivery_address: cartRows[0]?.[0] || null,
      items: itemRows.map((r) => ({
        product_id: r[0],
        product_name: r[1] || 'Product',
        image_url: r[2] || '',
        quantity: Number(r[3]),
        price: Number(r[4]),
      })),
      delivery: deliveryRows.length
        ? {
            tracking_id: deliveryRows[0][0],
            carrier: deliveryRows[0][1],
            delivery_status: deliveryRows[0][2],
            estimated_delivery_date: deliveryRows[0][3],
            shipped_date: deliveryRows[0][4],
          }
        : null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});
