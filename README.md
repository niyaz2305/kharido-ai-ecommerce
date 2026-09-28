# Kharido — AI-Powered Shopping & Payments on Databricks

Kharido is an end-to-end AI commerce demo built entirely on Databricks. Customers can browse a product catalog, search with natural language, add items to a cart, choose a delivery location, pay, place an order and track delivery — either by **chatting with an AI assistant** or by **clicking through a normal storefront UI**. Both paths read and write the same Unity Catalog tables.

The web app started from the Databricks Agent Chat Template (`e2e-chatbot-app-next`: ExpressJS + React + Vercel AI SDK) and was extended with a storefront, a checkout flow and custom agents.

---

## Table of contents

1. [What the system does](#1-what-the-system-does)
2. [Architecture](#2-architecture)
3. [Repository structure](#3-repository-structure)
4. [Data layer](#4-data-layer)
5. [Vector Search (AI Search)](#5-vector-search-ai-search)
6. [Genie and the Supervisor agent](#6-genie-and-the-supervisor-agent)
7. [Transaction Agent](#7-transaction-agent)
8. [Web application](#8-web-application)
9. [Two checkout paths](#9-two-checkout-paths)
10. [Setup from scratch](#10-setup-from-scratch)
11. [Testing](#11-testing)
12. [How the project evolved](#12-how-the-project-evolved)
13. [Problems we hit and how we fixed them](#13-problems-we-hit-and-how-we-fixed-them)
14. [Known limitations](#14-known-limitations)
15. [Roadmap](#15-roadmap)
16. [Credits](#16-credits)

---

## 1. What the system does

| Capability | Chat assistant | Storefront UI |
|---|---|---|
| Browse / search products | Yes (Vector Search + Genie) | Yes (SQL-backed grid, category filter, search box) |
| Add to cart | "Add this to my cart" | Add to Cart button, cart drawer opens automatically |
| Remove from cart | — | Remove button in cart drawer |
| Confirm cart | "Confirm my cart" | Confirm Cart & Continue |
| Delivery location | "Chennai, Tamil Nadu" | Address page with saved addresses and a **+** button (city and state only) |
| Payment | Method + card / UPI details in chat | Dedicated payment page with method-specific forms |
| Place order | "Place the order" | Create Order button after payment succeeds |
| Order history / tracking | "Where is my order?" | My Orders page and order detail page |

Supported payment methods: **Credit Card, Debit Card, Net Banking (asks for UPI ID), Cash on Delivery**.

---

## 2. Architecture

```
                        ┌──────────────────────────────┐
                        │   Databricks App (this repo)  │
                        │  React storefront + chat UI   │
                        │  Express API                  │
                        └───────┬─────────────┬─────────┘
                                │             │
             chat (streaming)   │             │  direct SQL (REST)
                                ▼             ▼
                ┌───────────────────────┐   ┌──────────────────────────┐
                │  Supervisor agent     │   │ /api/products            │
                │  (Agent Bricks MAS)   │   │ /api/checkout/*          │
                └───┬──────────────┬────┘   └────────────┬─────────────┘
                    │              │                     │
        product search             │ cart / payment /    │
                    ▼              ▼ order / tracking    ▼
        ┌───────────────────┐   ┌───────────────────┐  ┌───────────────────────────┐
        │ Vector Search     │   │ Transaction Agent │  │ SQL Warehouse             │
        │ index + Genie     │   │ (MLflow           │  │ ap2_ecommerce.gold.*      │
        │                   │   │  ResponsesAgent)  │─▶│ (Unity Catalog tables)    │
        └───────────────────┘   └───────────────────┘  └───────────────────────────┘
```

| Component | Technology | Purpose |
|---|---|---|
| Product data | Delta table `ap2_ecommerce.gold.product_catalog` | Cleaned product catalog (~28.9k rows) |
| Semantic search | Databricks Vector Search (Delta Sync, managed embeddings) | Natural-language product discovery |
| Genie space | Databricks Genie | Filtering / reasoning over catalog fields |
| Supervisor | Agent Bricks Multi-Agent Supervisor | Routes each message to the right tool |
| Transaction Agent | MLflow `ResponsesAgent` on Model Serving | Cart, delivery location, payment, orders, tracking |
| Web app | Databricks Apps (Node 20, Express, React, Vercel AI SDK) | Storefront, checkout pages, chat panel |
| SQL access | SQL Warehouse + SQL Statement Execution API | Storefront and checkout reads/writes |

---

## 3. Repository structure

```
e2e-chatbot-app-next/
├── app.yaml                          # Databricks App runtime config + env vars
├── databricks.yml                    # Asset Bundle config (serving endpoint variable)
├── client/src/
│   ├── App.tsx                       # Routes
│   ├── lib/
│   │   ├── image-url.ts              # Upgrades low-res Amazon thumbnails to full size
│   │   └── kharido-cart.ts           # Legacy client cart helpers
│   ├── components/
│   │   ├── chat.tsx, messages.tsx, message.tsx   # Chat UI (message.tsx renders tool calls)
│   │   ├── chat-product-results.tsx              # Product cards inside chat
│   │   └── kharido/
│   │       ├── KharidoProductCard.tsx            # Product card (image, discount ribbon, price)
│   │       └── KharidoProductGrid.tsx            # Staggered animated grid
│   └── pages/
│       ├── StorefrontPage.tsx        # Home: products, categories, cart drawer
│       ├── CheckoutAddressPage.tsx   # Choose / add delivery city + state
│       ├── CheckoutPaymentPage.tsx   # Payment method, details, success, Create Order
│       ├── OrderDetailPage.tsx       # Order confirmation / details
│       └── OrdersListPage.tsx        # Order history
└── server/src/
    ├── index.ts                      # Registers routers
    └── routes/
        ├── products.ts               # GET /api/products (SQL)
        ├── checkout.ts               # /api/checkout/* deterministic checkout (SQL)
        ├── cartActions.ts            # /api/cart/* legacy, calls Transaction Agent
        └── chat.ts                   # Streams to the Supervisor endpoint
```

Notebook / SQL assets (kept alongside the repo or in the workspace):

| File | Purpose |
|---|---|
| `create_product_catalog_index.py` | Creates the Vector Search index |
| `create_transaction_tables.sql` | Creates the transaction tables |
| `create_addresses_table.sql` | Creates `customer_addresses` |
| `reset_demo_data.sql` | Clears carts / orders / payments for a clean demo |
| `transaction_agent_final.py` | Transaction Agent source |

---

## 4. Data layer

### Product catalog

`ap2_ecommerce.gold.product_catalog`

| Column | Type | Notes |
|---|---|---|
| product_id | string | Primary key (32-char hex) |
| product_name | string | |
| product_description | string | Embedded for vector search |
| category | string | |
| brand | string | |
| pack_size_or_quantity | string | |
| mrp | double | List price |
| selling_price | double | Price charged |
| discount_percent | double | |
| seller | string | |
| availability | string | e.g. `IN_STOCK` |
| asin | string | |
| image_url | string | Amazon-hosted image |

The raw dataset was cleaned and loaded into the gold schema. A handful of rows (~37 of 28,909) had corrupted descriptions from CSV quote handling; this is negligible for search quality.

### Transaction tables (`ap2_ecommerce.gold`)

| Table | Used for |
|---|---|
| `intent_mandates` | Records the customer's purchase intent (AP2-style mandate) |
| `carts` | Cart lines and status: `PENDING_CONFIRMATION` → `CONFIRMED` → `ORDERED`; stores `delivery_address` |
| `payment_mandates` | Payment authorization / result, `payment_type`, `txn_id` |
| `risk_flags` | Audit log of blocked payments |
| `orders` | Placed orders |
| `deliveries` | Tracking id, carrier, delivery status, estimated date |
| `customer_addresses` | Saved city / state pairs for the storefront |

Leftover tables from earlier iterations (`cart_mandates`, `user_intent_mandates`, `customers`) are not used by the current code.

Create them by running `create_transaction_tables.sql` and `create_addresses_table.sql`.

---

## 5. Vector Search (AI Search)

- **Endpoint:** `product_search_endpoint` (reused across rebuilds)
- **Index:** `ap2_ecommerce.gold.product_catalog_index`
- **Type:** Delta Sync, `TRIGGERED` pipeline
- **Embedding:** managed, source column `product_description`, model `databricks-gte-large-en`
- **Primary key:** `product_id`
- **Prerequisite:** Change Data Feed enabled on the source table

Run `create_product_catalog_index.py` as a notebook. The first sync of ~29k rows can take a long time on a small endpoint (it took hours in our environment). Watch **Rows indexed** on the index page in Catalog Explorer; progress that keeps climbing means it is healthy.

Search results return each product's `doc_uri`, which **is the `product_id`**. The Supervisor uses this to add items to the cart reliably.

---

## 6. Genie and the Supervisor agent

The Supervisor is built with the **Agent Bricks Multi-Agent Supervisor** (no-code builder).

**Tools**

1. `product_catalog_index` (Vector Search) and the product-catalog Genie space — product discovery only.
2. The Transaction Agent endpoint `agents_ap2_ecommerce-gold-cart_agent` — everything else.

**Key instruction rules**

- Product search, browsing and comparison always go to the search tool, never to the Transaction Agent.
- When adding to cart, send the exact id: `Add to cart product_id: <doc_uri>`. Never send only a name when an id is known — several products share names across sizes and variants.
- Call each tool at most once per customer message; never invent a success message; relay tool errors honestly.
- Never expose tool names, SQL, raw JSON or internal ids to the customer.
- Forward confirmation, delivery location, payment method / details and order messages to the Transaction Agent unchanged.

**Permissions:** the app's service principal needs `CAN_QUERY` on the Supervisor endpoint and on the agents it orchestrates (add them as resources in `databricks.yml`). End users need access to each sub-agent.

---

## 7. Transaction Agent

`transaction_agent_final.py` — an MLflow `ResponsesAgent` (with `predict` and `predict_stream`) deployed to Model Serving.

### Design choices

- **No LLM inside the agent.** Intent detection is deterministic keyword / regex matching, so behavior is fast and predictable. (An optional LLM-assist layer is on the roadmap.)
- **State lives in the database**, not in the conversation. Each turn the agent looks at the customer's latest cart / mandate rows to decide what the next step is.
- **Always returns a valid response.** `predict` catches every exception and returns a friendly message.
- **Payment gateway is simulated locally** (returns an approved `TXNSIM…` id) so the demo does not depend on external OAuth or network calls.

### Conversation flow

```
Add to cart ─▶ Confirm cart ─▶ "Which city and state?" ─▶ "Proceed to payment"
   ─▶ Choose method
        ├─ Credit / Debit Card ─▶ ask card number + expiry ─▶ process payment
        ├─ Net Banking        ─▶ ask UPI ID               ─▶ process payment
        └─ Cash on Delivery   ─▶ confirmed immediately
   ─▶ Payment success (amount, method, transaction id, time)
   ─▶ "Place the order?" ─▶ Order created (product, qty, amount, location, order id, tracking id)
   ─▶ Order status / delivery tracking on request
```

### Risk check

Before a payment mandate is created, `risk_check()` flags the payment if the amount exceeds ₹100,000 or the payment amount does not match the live cart total. Flagged attempts are written to `risk_flags` and the payment is blocked. If the check itself fails, it fails **safe** (blocked).

### Credentials

The agent reads its connection settings from variables defined in a notebook cell above the class. Store them in a Databricks secret scope:

```python
SECRET_SCOPE = "<your-scope>"
DB_HOSTNAME  = dbutils.secrets.get(scope=SECRET_SCOPE, key="<hostname-key>")
DB_HTTP_PATH = dbutils.secrets.get(scope=SECRET_SCOPE, key="<http-path-key>")
DB_TOKEN     = dbutils.secrets.get(scope=SECRET_SCOPE, key="<token-key>")
DEFAULT_CUSTOMER_ID = "<same value as DEFAULT_CUSTOMER_ID in app.yaml>"
```

Use `dbutils.secrets.list(scope=...)` to confirm your actual key names.

### Deploy

```python
with mlflow.start_run():
    model_info = mlflow.pyfunc.log_model(
        artifact_path="cart_agent",
        python_model=transaction_agent,
        registered_model_name="ap2_ecommerce.gold.cart_agent",
    )
    print("Logged as version:", model_info.registered_model_version)

agents.deploy(
    "ap2_ecommerce.gold.cart_agent",
    model_info.registered_model_version,
    scale_to_zero=True,
)
```

Then confirm in **Serving** that the endpoint is serving the new version.

---

## 8. Web application

### Environment (`app.yaml`)

| Variable | Purpose |
|---|---|
| `DATABRICKS_SERVING_ENDPOINT` | Supervisor endpoint the chat talks to (from the `serving-endpoint` resource) |
| `CART_AGENT_ENDPOINT` | Transaction Agent endpoint (legacy `/api/cart/*` routes) |
| `SQL_WAREHOUSE_ID` | Warehouse used for storefront and checkout SQL |
| `DATABRICKS_HOST` | Workspace URL |
| `DEFAULT_CUSTOMER_ID` | Demo customer — **must equal** the agent's `DEFAULT_CUSTOMER_ID` |
| `CHAT_GREETING`, `LOG_SSE_EVENTS` | UI greeting and SSE logging |

App scopes: `model-serving`, `sql`.

### Routes

| Path | Page |
|---|---|
| `/` | Storefront |
| `/checkout/address` | Delivery address |
| `/checkout/payment` | Payment |
| `/orders` | Order history |
| `/orders/:orderId` | Order detail |
| `/assistant` | Chat with the Supervisor |

### API

| Endpoint | Description |
|---|---|
| `GET /api/products` | Catalog for the storefront |
| `GET/POST /api/checkout/addresses` | List / create saved addresses |
| `GET /api/checkout/cart` | Current cart with items and total |
| `POST /api/checkout/cart/add` · `cart/remove` · `cart/confirm` | Cart operations |
| `POST /api/checkout/pay` | Simulated payment |
| `POST /api/checkout/order` | Create order and delivery record |
| `GET /api/checkout/orders` · `orders/:id` | Order history / detail |

These run SQL directly with the signed-in user's forwarded token — no LLM involved.

### UI notes

- Product cards show real images, brand badge, discount ribbon and strikethrough MRP, with hover lift and staggered fade-in (Framer Motion).
- `client/src/lib/image-url.ts` removes Amazon's size token (e.g. `._SS40_`) so images load at full resolution instead of 40px thumbnails.
- The chat panel auto-approves MCP tool-approval requests (a `useEffect` in `message.tsx` calls `submitApproval(..., approve: true)`), so customers never see Allow / Deny prompts. Real authorization happens conversationally: the customer must explicitly confirm the cart, choose and provide payment details, and confirm the order.

### Deploy the app

```bash
databricks bundle validate
databricks bundle deploy
databricks bundle run databricks_chatbot
```

Set `serving_endpoint_name` in `databricks.yml` to your Supervisor endpoint.

---

## 9. Two checkout paths

| | Chat path | Click-through path |
|---|---|---|
| Entry | `/assistant` | Storefront `/` |
| Logic | Supervisor → Transaction Agent (Python) | `checkout.ts` (SQL) |
| Interpretation | Natural language + keyword matching | Deterministic buttons |
| Risk check | Yes | **Not yet** (see roadmap) |
| Data | Same tables | Same tables |

Because both use the same `DEFAULT_CUSTOMER_ID` and tables, a cart started in chat appears in the storefront and vice versa.

---

## 10. Setup from scratch

1. **Load and clean data** into `ap2_ecommerce.gold.product_catalog`.
2. **Create tables:** run `create_transaction_tables.sql` and `create_addresses_table.sql`.
3. **Create the Vector Search index:** run `create_product_catalog_index.py`; wait until the index is `ONLINE`.
4. **Create the Genie space** over `product_catalog`.
5. **Store credentials** in a secret scope; define the credential variables in the agent notebook.
6. **Deploy the Transaction Agent** (section 7). Confirm the serving version.
7. **Create the Supervisor** in Agent Bricks with the two tool groups and the instructions from section 6. Deploy it and note its endpoint name.
8. **Configure the app:** set the Supervisor endpoint in `databricks.yml`; set `SQL_WAREHOUSE_ID`, `DATABRICKS_HOST`, `CART_AGENT_ENDPOINT`, `DEFAULT_CUSTOMER_ID` in `app.yaml`; grant the app's service principal `CAN_QUERY` on the serving endpoints and access to the warehouse and tables.
9. **Deploy the app** (section 8).
10. **Keep the warehouse warm** before demos (see below).

---

## 11. Testing

We tested in three layers, from cheapest to most realistic.

**1. Agent in the notebook (fastest)**

```python
def ask(msg):
    r = transaction_agent.predict({"input": [{"role": "user", "content": msg}]})
    item = r.output[0]
    content = item["content"] if isinstance(item, dict) else item.content
    first = content[0]
    print(first["text"] if isinstance(first, dict) else first.text)
    print("---")

ask("Add <a real product name> to my cart")
ask("confirm cart")
ask("Chennai, Tamil Nadu")
ask("proceed to payment")
ask("cash on delivery")
ask("place the order")
ask("what's my order status")
```

**2. Deployed endpoints in Playground** — test the Transaction Agent alone, then the Supervisor with the same sequence (search → add → confirm → location → pay → order → track).

**3. The real app** — run the click-through flow on the storefront, then the same journey in the chat panel.

**Clean state before every demo:** run `reset_demo_data.sql`. Leftover test rows under the single demo customer cause confusing results such as "cart already confirmed" or an unrelated product appearing in an order.

**Keep the warehouse warm.** Small / free warehouses auto-stop and a cold start can exceed gunicorn's worker timeout. Run a keep-alive cell during demos:

```python
import time
from databricks import sql as db_sql

def keep_warehouse_warm(interval_seconds=240):
    while True:
        try:
            conn = db_sql.connect(server_hostname=DB_HOSTNAME,
                                  http_path=DB_HTTP_PATH, access_token=DB_TOKEN)
            cur = conn.cursor(); cur.execute("SELECT 1"); cur.fetchone()
            cur.close(); conn.close()
            print("Warehouse pinged", time.strftime("%H:%M:%S"))
        except Exception as e:
            print("Ping failed:", e)
        time.sleep(interval_seconds)

keep_warehouse_warm()
```

---

## 12. How the project evolved

1. **Rebuild on a new dataset.** Replaced the earlier Brazilian e-commerce data with a cleaned product catalog in `ap2_ecommerce.gold` and rebuilt everything around it.
2. **Search.** Deleted index → rebuilt a Delta Sync Vector Search index with managed embeddings on the existing endpoint.
3. **Agents.** Created a Genie space, a new Transaction Agent and a Supervisor; repointed everything from the old `ap2_dev` catalog to `ap2_ecommerce`.
4. **Storefront UI.** Rebuilt product cards, grid, header, category pills and cart drawer for the new schema, with real images and subtle animations.
5. **Stabilizing the Transaction Agent.** Fixed streaming support, syntax and indentation bugs, missing tables, warehouse cold starts, gateway auth failures and product-name ambiguity (details below).
6. **Full conversational checkout.** Added delivery city/state, payment method with card / UPI detail collection, payment success details, order creation and tracking.
7. **Deterministic checkout.** Added dedicated routes and pages (address book, payment, order detail, order history) that talk to the tables directly, independent of any LLM.
8. **Polish.** Removed tool-approval prompts from the chat, upgraded image resolution, tightened Supervisor instructions.

---

## 13. Problems we hit and how we fixed them

| Symptom | Cause | Fix |
|---|---|---|
| Chat / cart spins forever; `NotImplementedError: Streaming implementation not provided` | Agent implemented only `predict` | Added `predict_stream` that emits the `predict` result |
| `log_model` fails: `Input should be a valid dictionary or instance of ResponsesAgentResponse … NoneType` | Uncaught exception inside `predict` | Wrapped `predict` so it always returns a response |
| Workers killed (`WORKER TIMEOUT … SIGKILL`) after minutes | SQL warehouse cold start blocking `db_sql.connect` | Keep-alive script; `_socket_timeout` on connections; retry wrapper |
| "Something went wrong" on every non-add step | Methods written as `def_name` (missing space) and a mis-indented block that ran outside the `add_to_cart` branch | Corrected syntax and indentation |
| `TABLE_OR_VIEW_NOT_FOUND` for `intent_mandates` | Transaction tables never created in `ap2_ecommerce` | `create_transaction_tables.sql` |
| Products treated as "unavailable" | Availability check compared to `"in stock"`; data uses `IN_STOCK` | Normalize underscores before comparing |
| `invalid_client: Client authentication failed` on payment | Service principal OAuth to the mock gateway failed | Simulated the gateway locally |
| "Multiple products matched that product name" | Supervisor passed a name; catalog has several sizes / variants | Use `doc_uri` as `product_id`; agent now picks the closest match instead of failing; regex also accepts a bare hex id |
| Supervisor claimed success after a tool error | Instruction-following gap | Explicit "never fabricate, relay errors" rule |
| "confirm my cart" not recognized | Matcher required the exact phrase "confirm cart" | Match when both words appear |
| Allow / Deny tool prompts in chat | MCP tool-approval gate rendered by the UI | Auto-approve in `message.tsx`; real confirmation stays conversational |
| Blurry product images | Dataset URLs contain a 40px size token (`._SS40_`) | `getHighResImageUrl()` strips the token |
| Stale carts / wrong product in an order | Test data accumulated under one demo customer | `reset_demo_data.sql` |
| Duplicate cart additions | Supervisor called the agent twice for one request | "Call each tool at most once per message" rule |

---

## 14. Known limitations

- **Single demo customer** (`DEFAULT_CUSTOMER_ID`); no real user accounts or per-user carts.
- **Simulated payments.** No real gateway, and card / UPI details are not validated or stored. Do not use real card data.
- **Click-through checkout skips the risk check** that the chat path performs.
- Addresses are **city and state only**.
- Fuzzy name matching can pick a different size or variant when only a name is given; the `product_id` path avoids this.
- Product images depend on Amazon's CDN; some very old listings only exist at small sizes.
- Chat history persistence requires the optional Lakebase database (see the template docs).
- Not compiled or load-tested in the authoring sandbox — run `npm install && npm run build` before deploying.

---

## 15. Roadmap

- **LLM-assisted understanding inside the Transaction Agent** (planned): use a Databricks foundation model (for example `databricks-gpt-oss-20b` or `databricks-meta-llama-3-1-8b-instruct`) to classify messy phrasing and to choose between several catalog matches, with a hard timeout and automatic fallback to the current keyword logic.
- Apply the same risk checks to `checkout.ts` `/pay`.
- Real customer identity and per-user carts / addresses.
- Real payment gateway integration.
- Delivery status updates over time instead of a fixed "Shipped" record.
- Native slide-in chat panel on the storefront (currently navigates to `/assistant`).

---

## 16. Credits

The web app is built on the [Databricks Agent Chat Template](https://docs.databricks.com/aws/en/generative-ai/agent-framework/chat-app) (`app-templates/e2e-chatbot-app-next`). Optional template features — persistent chat history with Lakebase and MLflow feedback collection — are configured through `databricks.yml` and `app.yaml` as described in the template documentation.
