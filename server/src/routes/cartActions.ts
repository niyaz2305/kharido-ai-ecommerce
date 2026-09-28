import { Router, type Request, type Response, type Router as RouterType } from 'express';

export const cartActionsRouter: RouterType = Router();

const WORKSPACE_URL = process.env.DATABRICKS_HOST || '';
const CART_AGENT_ENDPOINT = process.env.CART_AGENT_ENDPOINT || 'agents_ap2_ecommerce-gold-cart_agent';

async function callCartAgent(token: string, message: string): Promise<string> {
  const response = await fetch(`${WORKSPACE_URL}/serving-endpoints/${CART_AGENT_ENDPOINT}/invocations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: [{ role: 'user', content: message }] }),
  });
  const data = await response.json();
  const output = data.output || [];
  for (let i = output.length - 1; i >= 0; i--) {
    if (output[i].type === 'message' && output[i].content) {
      return output[i].content[0].text;
    }
  }
  return JSON.stringify(data);
}

function getToken(req: Request): string | null {
  return (req.headers['x-forwarded-access-token'] as string) || null;
}

cartActionsRouter.post('/pay', async (req: Request, res: Response) => {
  const token = getToken(req);

  if (!token) {
    return res.status(401).json({
      error: 'Missing user token',
    });
  }

  const {
    cart_id,
    customer_id,
    payment_type,
  } = req.body;

  try {
    const reply = await callCartAgent(
      token,
      `Proceed with payment for cart ${cart_id} customer ${customer_id} using payment_type: ${payment_type}`,
    );

    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({
      error: err?.message || String(err),
    });
  }
});

cartActionsRouter.post('/confirm', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });
  const { cart_id } = req.body;
  try {
    const reply = await callCartAgent(token, `confirm cart ${cart_id}`);
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

cartActionsRouter.post('/order', async (req: Request, res: Response) => {
  const token = getToken(req);
  if (!token) return res.status(401).json({ error: 'Missing user token' });
  const { cart_id, customer_id } = req.body;
  try {
    const reply = await callCartAgent(token, `create order for cart ${cart_id} customer ${customer_id}`);
    res.json({ reply });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});