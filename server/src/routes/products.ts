import { Router, type Request, type Response, type Router as RouterType } from 'express';

export const productsRouter: RouterType = Router();

const WAREHOUSE_ID = process.env.SQL_WAREHOUSE_ID || '';
const WORKSPACE_URL = process.env.DATABRICKS_HOST || '';

productsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const token = req.headers['x-forwarded-access-token'] as string | undefined;
    if (!token) {
      return res.status(401).json({ error: 'Missing user token' });
    }

    console.log('[products] Warehouse:', WAREHOUSE_ID, 'Host:', WORKSPACE_URL, 'Token present:', !!token);

    const sqlResponse = await fetch(`${WORKSPACE_URL}/api/2.0/sql/statements`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        warehouse_id: WAREHOUSE_ID,
        statement: `
          SELECT
            product_id,
            product_name,
            product_description,
            category,
            brand,
            pack_size_or_quantity,
            mrp,
            selling_price,
            discount_percent,
            seller,
            availability,
            asin,
            image_url
          FROM ap2_ecommerce.gold.product_catalog
          ORDER BY discount_percent DESC
          LIMIT 200
`,
        wait_timeout: '30s',
      }),
    });

    const data = await sqlResponse.json();

    if (!data.result?.data_array) {
      return res.status(500).json({ error: 'No data returned', raw: data });
    }

    const products = data.result.data_array.map((row: any[]) => {
      return {
        product_id: row[0],
        product_name: row[1] || 'Unnamed product',
        product_description: row[2] || '',
        category: row[3] || 'other',
        brand: row[4] || '',
        pack_size_or_quantity: row[5] || '',
        mrp: Number(row[6]) || 0,
        selling_price: Number(row[7]) || 0,
        discount_percent: Number(row[8]) || 0,
        seller: row[9] || '',
        availability: row[10] || 'IN_STOCK',
        asin: row[11] || '',
        image_url: row[12]
          ? row[12].replace(/\._[^.]+(?=\.jpg|\.jpeg|\.png)/i, '')
          : '',
      };
    });

    res.json(products);
  } catch (err: any) {
    console.error('[products] error:', err);
    res.status(500).json({ error: 'Failed to fetch products', details: err?.message || String(err), stack: err?.stack });
  }
});
