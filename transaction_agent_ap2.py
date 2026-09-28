import uuid
import re
import time
import requests
import os
import json
import hashlib
from datetime import datetime, timezone

from databricks import sql as db_sql
from databricks.sdk import WorkspaceClient

import mlflow
from mlflow.pyfunc import ResponsesAgent
from mlflow.types.responses import (
    ResponsesAgentResponse,
    ResponsesAgentStreamEvent,
)


# ============================================================
# CREDENTIALS / CONFIG - paste this in a cell ABOVE the
# TransactionAgent class definition, then run it before
# defining/instantiating the class.
# ============================================================

class TransactionAgent(ResponsesAgent):

    def __init__(self):
        self._cart_conversation_column_checked = False

    # ========================================================
    # DATABASE CONNECTION
    # ========================================================

    def _connect(self):

        return db_sql.connect(
            server_hostname=DB_HOSTNAME,
            http_path=DB_HTTP_PATH,
            access_token=DB_TOKEN,
            _socket_timeout=25,
        )

    # ========================================================
    # SQL ESCAPE
    # ========================================================

    def _escape_sql(self, value):

        if value is None:
            return ""

        return str(value).replace("'", "''")

    # ========================================================
    # RETRY DATABASE OPERATIONS
    # ========================================================

    def _with_retry(self, func, max_attempts=3, delay_seconds=3):

        last_error = None

        for attempt in range(1, max_attempts + 1):

            try:
                return func()

            except Exception as e:

                last_error = e

                print(
                    f"Database operation failed "
                    f"(attempt {attempt}/{max_attempts}):",
                    repr(e)
                )

                if attempt < max_attempts:
                    time.sleep(delay_seconds)

        return {
            "error": f"Database operation failed: {str(last_error)}"
        }

    # ========================================================
    # RESPONSE HELPER
    # ========================================================

    def _result(self, success, operation, message, error_code=None, data=None):

        return {
            "success": bool(success),
            "operation": operation,
            "error_code": error_code,
            "message": str(message),
            "data": data or {},
        }

    def _response(self, result):
        """Return a deterministic transaction result for Supervisor consumption.

        The Supervisor must be able to recognize the transaction outcome from
        plain text without receiving raw JSON. The first fields are deliberately
        stable and explicit: TRANSACTION_RESULT, Success, and Operation.
        Customer-facing formatting remains the Supervisor's responsibility.
        """
        if not isinstance(result, dict):
            result = self._result(True, "GENERAL", result)

        def value_text(value):
            if value is None:
                return ""
            if isinstance(value, bool):
                return "Yes" if value else "No"
            return str(value)

        lines = [
            "TRANSACTION_RESULT",
            f"Success: {value_text(result.get('success'))}",
            f"Operation: {value_text(result.get('operation'))}",
            f"Error Code: {value_text(result.get('error_code'))}",
            f"Message: {value_text(result.get('message'))}",
        ]

        data = result.get("data")
        if isinstance(data, dict):
            for key, value in data.items():
                label = str(key).replace("_", " ").title()
                if isinstance(value, (dict, list)):
                    # Keep nested values readable without emitting JSON.
                    lines.append(f"{label}: {value_text(value)}")
                else:
                    lines.append(f"{label}: {value_text(value)}")
        elif data is not None:
            lines.append(f"Data: {value_text(data)}")

        text = "\n".join(lines)

        return ResponsesAgentResponse(
            id="resp_" + str(uuid.uuid4()),
            output=[
                {
                    "id": "msg_" + str(uuid.uuid4()),
                    "type": "message",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {
                            "type": "output_text",
                            "text": text,
                        }
                    ],
                }
            ],
        )

    def _get_conversation_id(self, request):
        """Return a non-empty conversation identifier from either request shape."""
        context = request.get("context") if isinstance(request, dict) else getattr(request, "context", None)
        if isinstance(context, dict):
            conversation_id = context.get("conversation_id")
        else:
            conversation_id = getattr(context, "conversation_id", None)
        if conversation_id is None:
            return None
        conversation_id = str(conversation_id).strip()
        return conversation_id or None

    def _get_context_user_id(self, request):
        context = request.get("context") if isinstance(request, dict) else getattr(request, "context", None)
        if isinstance(context, dict):
            user_id = context.get("user_id")
        else:
            user_id = getattr(context, "user_id", None)
        user_id = str(user_id or "").strip()
        return user_id or None

    def ensure_cart_conversation_column(self):
        """Idempotently add the nullable cart scope column on a new deployment."""
        if self._cart_conversation_column_checked:
            return {"status": "ready"}

        conn = None
        cursor = None
        try:
            conn = self._connect()
            cursor = conn.cursor()
            cursor.execute(
                "ALTER TABLE ap2_ecommerce.gold.carts "
                "ADD COLUMNS (conversation_id STRING)"
            )
        except Exception as exc:
            message = str(exc).lower()
            if (
                "already exists" not in message
                and "already_exists" not in message
                and "duplicate" not in message
            ):
                return {"error": f"Cart session schema migration failed: {exc}"}
        finally:
            if cursor is not None:
                cursor.close()
            if conn is not None:
                conn.close()

        self._cart_conversation_column_checked = True
        return {"status": "ready"}

    # ========================================================
    # EXTRACT USER MESSAGE
    # ========================================================

    def _extract_user_message(self, request):

        if hasattr(request, "input"):

            inputs = request.input

            if isinstance(inputs, str):
                return inputs

            if isinstance(inputs, list):

                for item in reversed(inputs):

                    if isinstance(item, dict):

                        if item.get("role") == "user":

                            content = item.get("content", "")

                            if isinstance(content, str):
                                return content

                            if isinstance(content, list):

                                for part in reversed(content):

                                    if isinstance(part, dict):

                                        if part.get("type") in (
                                            "input_text",
                                            "text",
                                        ):
                                            return part.get("text", "")

                    else:

                        role = getattr(item, "role", None)

                        if role == "user":

                            content = getattr(item, "content", "")

                            if isinstance(content, str):
                                return content

            return ""

        if isinstance(request, dict):

            value = request.get("input")

            if isinstance(value, str):
                return value

            if isinstance(value, list):

                for item in reversed(value):

                    if isinstance(item, dict):

                        if item.get("role") == "user":

                            content = item.get("content", "")

                            if isinstance(content, str):
                                return content

                            if isinstance(content, list):

                                for part in reversed(content):

                                    if isinstance(part, dict):

                                        if part.get("type") in (
                                            "input_text",
                                            "text",
                                        ):
                                            return part.get("text", "")

            message = request.get("message")

            if isinstance(message, str):
                return message

        return ""

    # ========================================================
    # PRODUCT LOOKUP BY ID
    # ========================================================

    def get_product_by_id(self, product_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    """
                    SELECT
                        product_id,
                        product_name,
                        selling_price,
                        availability
                    FROM ap2_ecommerce.gold.product_catalog
                    WHERE product_id = ?
                    LIMIT 1
                    """,
                    (product_id,)
                )

                row = cursor.fetchone()

                if not row:
                    return {
                        "error": f"Product not found for product_id: {product_id}"
                    }

                return {
                    "product_id": row[0],
                    "product_name": row[1],
                    "price": float(row[2]),
                    "availability": row[3],
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # PRODUCT LOOKUP BY NAME
    # ========================================================

    def get_product_by_name(self, product_name):

        product_name = str(product_name).strip()

        escaped_name = self._escape_sql(product_name)

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                # Exact match first
                cursor.execute(
                    f"""
                    SELECT
                        product_id,
                        product_name,
                        selling_price,
                        availability
                    FROM ap2_ecommerce.gold.product_catalog
                    WHERE LOWER(TRIM(product_name)) = LOWER(TRIM('{escaped_name}'))
                    LIMIT 2
                    """
                )

                rows = cursor.fetchall()

                # Fuzzy fallback
                if not rows:

                    cursor.execute(
                        f"""
                        SELECT
                            product_id,
                            product_name,
                            selling_price,
                            availability
                        FROM ap2_ecommerce.gold.product_catalog
                        WHERE LOWER(product_name) LIKE LOWER('%{escaped_name}%')
                        LIMIT 2
                        """
                    )

                    rows = cursor.fetchall()

                if not rows:
                    return {
                        "error": "I couldn't find that product in the catalog."
                    }

                if len(rows) > 1:
                    return {
                        "error": "Multiple products matched that product name."
                    }

                row = rows[0]

                return {
                    "product_id": row[0],
                    "product_name": row[1],
                    "price": float(row[2]),
                    "availability": row[3],
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # CUSTOMER
    # ========================================================

    def get_customer_id(self):
        return DEFAULT_CUSTOMER_ID

    def resolve_customer_id(self, request):
        """Resolve authenticated customer ownership; preserve direct-test fallback."""
        user_id = self._get_context_user_id(request)
        if not user_id:
            return {"customer_id": self.get_customer_id(), "authenticated": False}

        email = user_id.strip().lower()
        if "@" not in email:
            return {"error": "Authenticated user identity must include an email address."}

        customer_id = "CUST_" + hashlib.sha256(email.encode("utf-8")).hexdigest()[:16].upper()
        local_part = re.sub(r"[^A-Za-z0-9 ._-]", "", email.split("@", 1)[0]).strip()
        customer_name = local_part or "Customer"

        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    SELECT customer_id
                    FROM ap2_ecommerce.gold.customers
                    WHERE lower(email) = lower('{self._escape_sql(email)}')
                    LIMIT 1
                    """
                )
                existing = cursor.fetchone()
                if existing:
                    return {"customer_id": existing[0], "authenticated": True}

                cursor.execute(
                    f"""
                    INSERT INTO ap2_ecommerce.gold.customers
                    (customer_id, customer_name, email, created_at)
                    VALUES (
                        '{self._escape_sql(customer_id)}',
                        '{self._escape_sql(customer_name)}',
                        '{self._escape_sql(email)}',
                        current_timestamp()
                    )
                    """
                )
                return {"customer_id": customer_id, "authenticated": True}
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # INTENT MANDATE
    # ========================================================

    def create_intent_mandate(self, customer_id):

        mandate_id = "INTENT" + str(uuid.uuid4())[:8].upper()

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    INSERT INTO ap2_ecommerce.gold.intent_mandates
                    (mandate_id, customer_id, status, created_at, confirmed_at)
                    VALUES (
                        '{mandate_id}',
                        '{self._escape_sql(customer_id)}',
                        'CONFIRMED',
                        current_timestamp(),
                        current_timestamp()
                    )
                    """
                )

                return {
                    "status": "success",
                    "mandate_id": mandate_id,
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # CREATE / MERGE CART
    # ========================================================

    def create_cart_in_db(self, customer_id, conversation_id, product_id, quantity, price):
        """Create/reuse a pending cart strictly inside the current conversation.

        A customer's pending carts from other conversations must never be merged
        into the current checkout.  Within one conversation, the same product is
        intentionally quantity-incremented when the user explicitly adds it again.
        """
        conversation_id = str(conversation_id or "").strip()
        if not conversation_id:
            return {"error": "A conversation ID is required for cart operations."}

        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT cart_id
                    FROM ap2_ecommerce.gold.carts
                    WHERE customer_id = '{self._escape_sql(customer_id)}'
                      AND conversation_id = '{self._escape_sql(conversation_id)}'
                      AND status = 'PENDING_CONFIRMATION'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                existing = cursor.fetchone()

                if existing:
                    cart_id = existing[0]
                else:
                    cart_id = "CART" + str(uuid.uuid4())[:8].upper()

                cursor.execute(
                    f"""
                    SELECT quantity
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                      AND conversation_id = '{self._escape_sql(conversation_id)}'
                      AND product_id = '{self._escape_sql(product_id)}'
                    LIMIT 1
                    """
                )
                existing_product = cursor.fetchone()

                if existing_product:
                    new_quantity = int(existing_product[0]) + int(quantity)
                    cursor.execute(
                        f"""
                        UPDATE ap2_ecommerce.gold.carts
                        SET quantity = {new_quantity},
                            price = {float(price)}
                        WHERE cart_id = '{self._escape_sql(cart_id)}'
                          AND customer_id = '{self._escape_sql(customer_id)}'
                          AND conversation_id = '{self._escape_sql(conversation_id)}'
                          AND product_id = '{self._escape_sql(product_id)}'
                        """
                    )
                else:
                    cursor.execute(
                        f"""
                        INSERT INTO ap2_ecommerce.gold.carts
                        (cart_id, customer_id, conversation_id, product_id, quantity, price, status, created_at)
                        VALUES (
                            '{self._escape_sql(cart_id)}',
                            '{self._escape_sql(customer_id)}',
                            '{self._escape_sql(conversation_id)}',
                            '{self._escape_sql(product_id)}',
                            {int(quantity)},
                            {float(price)},
                            'PENDING_CONFIRMATION',
                            current_timestamp()
                        )
                        """
                    )

                return {"status": "success", "cart_id": cart_id}
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def get_cart_total(self, cart_id, customer_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT COALESCE(SUM(price * quantity), 0)
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    """
                )

                row = cursor.fetchone()

                return float(row[0] or 0)

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # PENDING / CONFIRMED CART LOOKUPS
    # ========================================================

    def get_pending_cart(self, customer_id, conversation_id):
        """Return the newest pending cart for this customer AND conversation."""
        conversation_id = str(conversation_id or "").strip()
        if not conversation_id:
            return None

        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    SELECT cart_id, product_id, quantity, price, delivery_address
                    FROM ap2_ecommerce.gold.carts
                    WHERE customer_id = '{self._escape_sql(customer_id)}'
                      AND conversation_id = '{self._escape_sql(conversation_id)}'
                      AND status = 'PENDING_CONFIRMATION'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()
                if not row:
                    return None
                return {
                    "cart_id": row[0],
                    "product_id": row[1],
                    "quantity": int(row[2]),
                    "price": float(row[3]),
                    "delivery_address": row[4],
                }
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def get_confirmed_cart(self, customer_id, conversation_id):
        """Return the newest confirmed cart for this customer AND conversation."""
        conversation_id = str(conversation_id or "").strip()
        if not conversation_id:
            return None

        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    SELECT cart_id, product_id, quantity, price, delivery_address
                    FROM ap2_ecommerce.gold.carts
                    WHERE customer_id = '{self._escape_sql(customer_id)}'
                      AND conversation_id = '{self._escape_sql(conversation_id)}'
                      AND status = 'CONFIRMED'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()
                if not row:
                    return None
                return {
                    "cart_id": row[0],
                    "product_id": row[1],
                    "quantity": int(row[2]),
                    "price": float(row[3]),
                    "delivery_address": row[4],
                }
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def save_delivery_address(self, cart_id, customer_id, address):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    UPDATE ap2_ecommerce.gold.carts
                    SET delivery_address = '{self._escape_sql(address)}'
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    """
                )

                return {
                    "status": "success",
                    "cart_id": cart_id,
                    "delivery_address": address,
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def get_delivery_address(self, cart_id, customer_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT delivery_address
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    LIMIT 1
                    """
                )

                row = cursor.fetchone()

                if not row:
                    return None

                return row[0]

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # CONFIRM CART
    # ========================================================

    def confirm_cart(self, cart_id, customer_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT status
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    LIMIT 1
                    """
                )

                row = cursor.fetchone()

                if not row:
                    return {"error": "Cart was not found."}

                if row[0] == "CONFIRMED":
                    return {"status": "already_confirmed", "cart_id": cart_id}

                if row[0] != "PENDING_CONFIRMATION":
                    return {"error": "This cart cannot be confirmed."}

                cursor.execute(
                    f"""
                    UPDATE ap2_ecommerce.gold.carts
                    SET status = 'CONFIRMED'
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    """
                )

                return {"status": "confirmed", "cart_id": cart_id}

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # RISK CHECK
    # ========================================================

    def risk_check(self, customer_id, cart_id, amount):

        try:

            flags = []

            if float(amount) > 100000:
                flags.append("Transaction amount is unusually high.")

            actual_total = self.get_cart_total(cart_id, customer_id)

            if isinstance(actual_total, dict):
                flags.append("Unable to verify cart total.")
            elif abs(float(actual_total) - float(amount)) > 0.01:
                flags.append("Cart total mismatch detected.")

            if flags:

                def _save_flags():

                    conn = self._connect()

                    try:

                        cursor = conn.cursor()

                        for flag in flags:

                            cursor.execute(
                                f"""
                                INSERT INTO ap2_ecommerce.gold.risk_flags
                                (customer_id, cart_id, reason, created_at)
                                VALUES (
                                    '{self._escape_sql(customer_id)}',
                                    '{self._escape_sql(cart_id)}',
                                    '{self._escape_sql(flag)}',
                                    current_timestamp()
                                )
                                """
                            )

                        return True

                    finally:

                        cursor.close()
                        conn.close()

                self._with_retry(_save_flags)

                return {"status": "FLAGGED", "flags": flags}

            return {"status": "CLEAR", "flags": []}

        except Exception as e:

            print("Risk check error:", repr(e))

            return {
                "status": "FLAGGED",
                "flags": ["Risk verification failed."],
            }

    # ========================================================
    # PAYMENT MANDATE
    # ========================================================

    def create_payment_mandate(self, cart_id, customer_id, payment_type):
        """Create one active payment mandate for the current cart.

        Reuses a pending mandate only when its payment type matches.  A pending
        mandate for another method is cancelled before a new one is created.
        """
        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT mandate_id, amount, payment_type, status
                    FROM ap2_ecommerce.gold.payment_mandates
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                      AND status = 'PENDING'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                existing = cursor.fetchone()

                if existing:
                    existing_id, existing_amount, existing_type, _ = existing
                    if str(existing_type) == str(payment_type):
                        return {
                            "status": "PENDING",
                            "mandate_id": existing_id,
                            "amount": float(existing_amount),
                            "payment_type": existing_type,
                        }

                    cursor.execute(
                        f"""
                        UPDATE ap2_ecommerce.gold.payment_mandates
                        SET status = 'CANCELLED', confirmed_at = current_timestamp()
                        WHERE mandate_id = '{self._escape_sql(existing_id)}'
                        """
                    )

                amount = self.get_cart_total(cart_id, customer_id)
                if isinstance(amount, dict):
                    return amount

                risk = self.risk_check(customer_id, cart_id, amount)
                if risk.get("status") != "CLEAR":
                    return {"status": "RISK_FLAGGED", "flags": risk.get("flags", [])}

                mandate_id = "MANDATE" + str(uuid.uuid4())[:8].upper()
                cursor.execute(
                    f"""
                    INSERT INTO ap2_ecommerce.gold.payment_mandates
                    (mandate_id, cart_id, customer_id, amount, payment_type, status, created_at)
                    VALUES (
                        '{mandate_id}',
                        '{self._escape_sql(cart_id)}',
                        '{self._escape_sql(customer_id)}',
                        {float(amount)},
                        '{self._escape_sql(payment_type)}',
                        'PENDING',
                        current_timestamp()
                    )
                    """
                )

                return {
                    "status": "PENDING",
                    "mandate_id": mandate_id,
                    "amount": float(amount),
                    "payment_type": payment_type,
                }
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def call_payment_gateway(self, amount, payment_type):

        # DEMO MODE: simulate the mock gateway locally instead of calling
        # the external app, to remove OAuth/network as a point of failure.
        try:
            txn_id = "TXNSIM" + str(uuid.uuid4())[:10].upper()

            print(
                "Simulated payment gateway approval:",
                {"amount": amount, "payment_type": payment_type, "txn_id": txn_id},
            )

            return {
                "gateway_txn_id": txn_id,
                "status": "approved",
            }

        except Exception as e:

            print("Payment gateway error:", repr(e))

            return {
                "gateway_txn_id": None,
                "status": "gateway_error",
                "error": str(e),
            }

    # ========================================================
    # CONFIRM / PROCESS PAYMENT
    # ========================================================

    def confirm_payment(self, cart_id, customer_id):
        """Complete the latest pending payment mandate after revalidating amount."""
        def _get_mandate():
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    SELECT mandate_id, amount, payment_type, status
                    FROM ap2_ecommerce.gold.payment_mandates
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                      AND status IN ('PENDING', 'SUCCESS')
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                row = cursor.fetchone()
                if not row:
                    return {"error": "There is no pending payment authorization."}
                return {
                    "mandate_id": row[0],
                    "amount": float(row[1]),
                    "payment_type": row[2],
                    "status": row[3],
                }
            finally:
                cursor.close()
                conn.close()

        mandate = self._with_retry(_get_mandate)
        if "error" in mandate:
            return mandate

        mandate_id = mandate["mandate_id"]
        amount = float(mandate["amount"])
        payment_type = mandate["payment_type"]
        status = mandate["status"]

        # Idempotent: never charge the same successful mandate twice.
        if status == "SUCCESS":
            def _get_success_txn():
                conn = self._connect()
                try:
                    cursor = conn.cursor()
                    cursor.execute(
                        f"""
                        SELECT txn_id
                        FROM ap2_ecommerce.gold.payment_mandates
                        WHERE mandate_id = '{self._escape_sql(mandate_id)}'
                        LIMIT 1
                        """
                    )
                    row = cursor.fetchone()
                    return row[0] if row else None
                finally:
                    cursor.close()
                    conn.close()
            txn_id = self._with_retry(_get_success_txn)
            return {
                "status": "SUCCESS",
                "mandate_id": mandate_id,
                "amount": amount,
                "payment_type": payment_type,
                "txn_id": txn_id,
            }

        # Re-read the cart total immediately before payment. Payment amount must
        # always equal the actual cart total.
        current_total = self.get_cart_total(cart_id, customer_id)
        if isinstance(current_total, dict):
            return current_total
        if abs(float(current_total) - amount) > 0.01:
            return {
                "status": "FAILED",
                "mandate_id": mandate_id,
                "amount": amount,
                "payment_type": payment_type,
                "error": "The cart total changed after payment authorization. Please choose the payment method again.",
            }

        if payment_type == "cod":
            def _confirm_cod():
                conn = self._connect()
                try:
                    cursor = conn.cursor()
                    txn_id = "COD" + str(uuid.uuid4())[:8].upper()
                    cursor.execute(
                        f"""
                        UPDATE ap2_ecommerce.gold.payment_mandates
                        SET status = 'SUCCESS',
                            txn_id = '{self._escape_sql(txn_id)}',
                            confirmed_at = current_timestamp()
                        WHERE mandate_id = '{self._escape_sql(mandate_id)}'
                          AND status = 'PENDING'
                        """
                    )
                    return txn_id
                finally:
                    cursor.close()
                    conn.close()
            txn_id = self._with_retry(_confirm_cod)
            if isinstance(txn_id, dict) and "error" in txn_id:
                return txn_id
            return {
                "status": "SUCCESS",
                "mandate_id": mandate_id,
                "amount": amount,
                "payment_type": payment_type,
                "txn_id": txn_id,
            }

        gateway = self.call_payment_gateway(amount, payment_type)
        gateway_status = gateway.get("status")
        txn_id = gateway.get("gateway_txn_id")
        if gateway_status != "approved" or not txn_id:
            return {
                "status": "FAILED",
                "mandate_id": mandate_id,
                "amount": amount,
                "payment_type": payment_type,
                "error": gateway.get("error", "Payment was declined."),
            }

        def _save_success():
            conn = self._connect()
            try:
                cursor = conn.cursor()
                cursor.execute(
                    f"""
                    UPDATE ap2_ecommerce.gold.payment_mandates
                    SET status = 'SUCCESS',
                        txn_id = '{self._escape_sql(txn_id)}',
                        confirmed_at = current_timestamp()
                    WHERE mandate_id = '{self._escape_sql(mandate_id)}'
                      AND status = 'PENDING'
                    """
                )
                return True
            finally:
                cursor.close()
                conn.close()

        saved = self._with_retry(_save_success)
        if isinstance(saved, dict) and "error" in saved:
            return saved

        return {
            "status": "SUCCESS",
            "mandate_id": mandate_id,
            "txn_id": txn_id,
            "amount": amount,
            "payment_type": payment_type,
        }

    def create_order(self, cart_id, customer_id):
        """Create one idempotent order from the fully validated cart."""
        def _do():
            conn = self._connect()
            try:
                cursor = conn.cursor()

                # The cart must have a successful payment whose amount equals the
                # current cart total.
                cursor.execute(
                    f"""
                    SELECT mandate_id, txn_id, amount, payment_type, status
                    FROM ap2_ecommerce.gold.payment_mandates
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                      AND status = 'SUCCESS'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
                payment = cursor.fetchone()
                if not payment:
                    return {"error": "No successful payment was found for this cart."}

                mandate_id, txn_id, amount, payment_type, payment_status = (
                    payment[0], payment[1], float(payment[2]), payment[3], payment[4]
                )

                cursor.execute(
                    f"""
                    SELECT status, delivery_address
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    ORDER BY created_at ASC
                    LIMIT 1
                    """
                )
                cart_meta = cursor.fetchone()
                if not cart_meta:
                    return {"error": "Cart was not found."}

                if cart_meta[0] != 'CONFIRMED':
                    return {"error": "Cart must be confirmed before creating the order."}

                delivery_address = cart_meta[1]
                if not delivery_address:
                    return {"error": "Delivery location is required before creating the order."}

                cursor.execute(
                    f"""
                    SELECT product_id, quantity, price
                    FROM ap2_ecommerce.gold.carts
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    ORDER BY created_at ASC
                    """
                )
                rows = cursor.fetchall()
                if not rows:
                    return {"error": "Cart was not found."}

                actual_total = sum(float(row[2]) * int(row[1]) for row in rows)
                if abs(actual_total - amount) > 0.01:
                    return {"error": "Payment amount does not match the current cart total."}

                product_ids = [str(row[0]) for row in rows]
                quantities = [int(row[1]) for row in rows]

                names = []
                for product_id, quantity in zip(product_ids, quantities):
                    cursor.execute(
                        f"""
                        SELECT product_name
                        FROM ap2_ecommerce.gold.product_catalog
                        WHERE product_id = '{self._escape_sql(product_id)}'
                        LIMIT 1
                        """
                    )
                    product = cursor.fetchone()
                    product_name = product[0] if product else product_id
                    names.append(f"{product_name} x{quantity}")

                product_summary = ", ".join(names)
                total_quantity = sum(quantities)

                # Idempotency: never create a second order for the same cart.
                cursor.execute(
                    f"""
                    SELECT order_id, txn_id, amount, status
                    FROM ap2_ecommerce.gold.orders
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    LIMIT 1
                    """
                )
                existing = cursor.fetchone()
                if existing:
                    cursor.execute(
                        f"""
                        SELECT tracking_id
                        FROM ap2_ecommerce.gold.deliveries
                        WHERE order_id = '{self._escape_sql(existing[0])}'
                        ORDER BY updated_at DESC
                        LIMIT 1
                        """
                    )
                    delivery = cursor.fetchone()
                    return {
                        "order_id": existing[0],
                        "cart_id": cart_id,
                        "product_id": product_ids[0],
                        "product_name": product_summary,
                        "quantity": total_quantity,
                        "amount": float(existing[2]),
                        "payment_type": payment_type,
                        "payment_status": payment_status,
                        "txn_id": existing[1],
                        "delivery_address": delivery_address,
                        "tracking_id": delivery[0] if delivery else None,
                        "status": "already_exists",
                    }

                order_id = "ORDER" + str(uuid.uuid4())[:8].upper()
                txn_sql = "NULL" if not txn_id else f"'{self._escape_sql(txn_id)}'"

                cursor.execute(
                    f"""
                    INSERT INTO ap2_ecommerce.gold.orders
                    (order_id, cart_id, customer_id, mandate_id, txn_id, amount, status, created_at)
                    VALUES (
                        '{order_id}',
                        '{self._escape_sql(cart_id)}',
                        '{self._escape_sql(customer_id)}',
                        '{self._escape_sql(mandate_id)}',
                        {txn_sql},
                        {float(actual_total)},
                        'created',
                        current_timestamp()
                    )
                    """
                )

                tracking_id = "TRK" + str(uuid.uuid4())[:10].upper()
                cursor.execute(
                    f"""
                    INSERT INTO ap2_ecommerce.gold.deliveries
                    (order_id, tracking_id, carrier, delivery_status,
                     estimated_delivery_date, shipped_date, updated_at)
                    VALUES (
                        '{order_id}',
                        '{tracking_id}',
                        'AP2 Express',
                        'Shipped',
                        DATE_ADD(CURRENT_DATE(), 3),
                        CURRENT_DATE(),
                        CURRENT_TIMESTAMP()
                    )
                    """
                )

                cursor.execute(
                    f"""
                    UPDATE ap2_ecommerce.gold.carts
                    SET status = 'ORDERED'
                    WHERE cart_id = '{self._escape_sql(cart_id)}'
                      AND customer_id = '{self._escape_sql(customer_id)}'
                    """
                )

                return {
                    "order_id": order_id,
                    "cart_id": cart_id,
                    "product_id": product_ids[0],
                    "product_name": product_summary,
                    "quantity": total_quantity,
                    "amount": float(actual_total),
                    "payment_type": payment_type,
                    "payment_status": payment_status,
                    "txn_id": txn_id,
                    "delivery_address": delivery_address,
                    "tracking_id": tracking_id,
                    "status": "created",
                }
            finally:
                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def get_latest_order(self, customer_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT order_id, cart_id, amount, txn_id, status, created_at
                    FROM ap2_ecommerce.gold.orders
                    WHERE customer_id = '{self._escape_sql(customer_id)}'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )

                row = cursor.fetchone()

                if not row:
                    return None

                return {
                    "order_id": row[0],
                    "cart_id": row[1],
                    "amount": float(row[2]),
                    "txn_id": row[3],
                    "status": row[4],
                    "created_at": str(row[5]),
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    def get_delivery(self, order_id):

        def _do():

            conn = self._connect()

            try:

                cursor = conn.cursor()

                cursor.execute(
                    f"""
                    SELECT tracking_id, carrier, delivery_status,
                           estimated_delivery_date, shipped_date
                    FROM ap2_ecommerce.gold.deliveries
                    WHERE order_id = '{self._escape_sql(order_id)}'
                    ORDER BY updated_at DESC
                    LIMIT 1
                    """
                )

                row = cursor.fetchone()

                if not row:
                    return None

                return {
                    "tracking_id": row[0],
                    "carrier": row[1],
                    "delivery_status": row[2],
                    "estimated_delivery_date": str(row[3]),
                    "shipped_date": str(row[4]),
                }

            finally:

                cursor.close()
                conn.close()

        return self._with_retry(_do)

    # ========================================================
    # INTENT DETECTION
    # ========================================================

    def _detect_intent_keyword(self, message):

        text = message.lower().strip()

        if any(p in text for p in [
            "where is my order", "where's my order", "track my order",
            "track order", "order status", "delivery status", "track delivery",
        ]):
            return "order_status"

        if any(p in text for p in [
            "place order", "create order", "yes place", "yes, place",
            "confirm order", "proceed with order", "place the order",
        ]):
            return "create_order"

        if any(p in text for p in [
            "credit card", "debit card", "net banking", "netbanking",
            "cash on delivery", "cod", "upi",
        ]):
            return "payment_method"

        if any(p in text for p in [
            "proceed to payment", "proceed with payment", "go to payment",
            "proceed", "yes proceed",
        ]):
            return "goto_payment"

        words = set(text.split())

        if (
            any(p in text for p in [
                "confirm cart", "cart confirm", "checkout", "proceed to checkout",
            ])
            or text.strip() in ("yes", "confirm", "yep", "ok", "okay")
            or ("confirm" in words and "cart" in words)
        ):
            return "confirm_cart"

        if any(p in text for p in [
            "add ", "add to cart", "buy ", "purchase ",
        ]):
            return "add_to_cart"

        return "unknown"

    def _classify_intent_with_foundation_model(self, message):
        """Return a validated Foundation Model intent label, or None on failure.

        The endpoint name is deliberately configuration-only.  An unavailable
        endpoint must not affect transaction handling because _detect_intent()
        falls back to the existing keyword classifier.
        """
        endpoint = os.getenv("FOUNDATION_MODEL_ENDPOINT", "").strip()
        if not endpoint:
            return None

        allowed_labels = {
            "order_status",
            "create_order",
            "payment_method",
            "goto_payment",
            "confirm_cart",
            "add_to_cart",
            "unknown",
        }
        system_prompt = (
            "You are an ecommerce transaction intent classifier.\n"
            "Classify the user's message into exactly one label:\n"
            "order_status, create_order, payment_method, goto_payment, "
            "confirm_cart, add_to_cart, unknown.\n"
            "Return only the label.\n"
            "Do not execute actions.\n"
            "Do not infer product IDs.\n"
            "Do not modify transaction state."
        )

        try:
            # This reuses the project's Databricks SDK authentication pattern
            # already used for serving-endpoint invocation in the app source.
            from databricks.sdk.core import Config

            config = Config()
            host = (config.host or "").rstrip("/")
            if not host:
                return None

            auth_headers = config.authenticate()
            if isinstance(auth_headers, dict):
                headers = {**auth_headers, "Content-Type": "application/json"}
            else:
                headers = {
                    "Authorization": f"Bearer {auth_headers}",
                    "Content-Type": "application/json",
                }

            response = requests.post(
                f"{host}/serving-endpoints/{endpoint}/invocations",
                headers=headers,
                json={
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": str(message)},
                    ],
                    "temperature": 0,
                    "max_tokens": 8,
                },
                timeout=8,
            )
            response.raise_for_status()
            payload = response.json()

            raw_label = None
            choices = payload.get("choices") if isinstance(payload, dict) else None
            if choices and isinstance(choices[0], dict):
                message_content = choices[0].get("message", {}).get("content")
                raw_label = message_content
            elif isinstance(payload, dict) and isinstance(payload.get("predictions"), list):
                raw_label = payload["predictions"][0] if payload["predictions"] else None

            label = str(raw_label or "").strip().lower()
            return label if label in allowed_labels else None
        except Exception as exc:
            print("Foundation Model intent classification unavailable:", repr(exc))
            return None

    def _detect_intent(self, message):
        foundation_model_intent = self._classify_intent_with_foundation_model(message)
        if foundation_model_intent is not None:
            return foundation_model_intent
        return self._detect_intent_keyword(message)

    def _extract_payment_type(self, message):

        text = message.lower()

        if "credit card" in text:
            return "credit_card"
        if "debit card" in text:
            return "debit_card"
        if "cash on delivery" in text or re.search(r"\bcod\b", text):
            return "cod"
        if "net banking" in text or "netbanking" in text:
            return "net_banking"
        if "upi" in text:
            return "net_banking"

        return None

    def _extract_product_name(self, message):

        text = message.strip()

        patterns = [
            r"add\s+(.+?)\s+to\s+(?:my\s+)?cart",
            r"add\s+(.+?)\s+cart",
            r"buy\s+(.+)",
            r"purchase\s+(.+)",
        ]

        for pattern in patterns:

            match = re.search(pattern, text, re.IGNORECASE)

            if match:

                product_name = match.group(1).strip()

                product_name = re.sub(
                    r"\s+please$", "", product_name, flags=re.IGNORECASE
                )

                return product_name

        return None

    def _looks_like_city_state(self, text):
        """Very light heuristic: short text, letters/commas/spaces only,
        not an obvious command keyword."""

        cleaned = text.strip()

        if len(cleaned) < 3 or len(cleaned) > 80:
            return False

        if not re.match(r"^[A-Za-z\s,.\-]+$", cleaned):
            return False

        command_words = [
            "yes", "no", "confirm", "proceed", "cart", "cod",
            "credit", "debit", "card", "upi", "banking", "order",
        ]

        lowered = cleaned.lower()

        if any(word in lowered for word in command_words):
            return False

        return True

    # ========================================================
    # PREDICT INNER — full end-to-end flow
    # ========================================================

    def _predict_inner(self, message, conversation_id, intent=None, customer_id=None):

        customer_id = customer_id or self.get_customer_id()

        if intent is None:
            intent = self._detect_intent(message)

        print("TransactionAgent intent:", intent)

        # ====================================================
        # ADD TO CART
        # ====================================================

        if intent == "add_to_cart":

            product_id_match = re.search(
                r"product[_\s-]?id\s*[:=]\s*([a-fA-F0-9]{8,64})",
                message,
                re.IGNORECASE,
            )

            if product_id_match:

                product_id = product_id_match.group(1)
                product = self.get_product_by_id(product_id)

            else:

                product_name = self._extract_product_name(message)

                if not product_name:
                    return self._result(False, "ADD_TO_CART", "Please tell me which product you'd like to add to your cart.", "PRODUCT_NAME_REQUIRED")

                product = self.get_product_by_name(product_name)

            if "error" in product:
                return self._result(False, "ADD_TO_CART", product["error"], "PRODUCT_LOOKUP_FAILED")

            availability = str(product.get("availability", "")).lower().replace("_", " ")

            if availability not in ("", "available", "in stock", "instock", "true"):
                return self._result(False, "ADD_TO_CART", f"{product['product_name']} is currently unavailable.", "PRODUCT_UNAVAILABLE")

            mandate = self.create_intent_mandate(customer_id)

            if "error" in mandate:
                return self._result(False, "ADD_TO_CART", mandate["error"], "INTENT_MANDATE_FAILED")

            cart = self.create_cart_in_db(
                customer_id=customer_id,
                conversation_id=conversation_id,
                product_id=product["product_id"],
                quantity=1,
                price=product["price"],
            )

            if "error" in cart:
                return self._result(False, "ADD_TO_CART", cart["error"], "CART_CREATION_FAILED")

            total = self.get_cart_total(cart["cart_id"], customer_id)

            if isinstance(total, dict):
                total = product["price"]

            return self._result(True, "ADD_TO_CART", (
                f"Added {product['product_name']} to your cart.\n\n"
                f"Price: Rs.{product['price']:.2f}\n"
                f"Cart total: Rs.{float(total):.2f}\n\n"
                f"Would you like to confirm your cart?"
            ), data={
                "cart_id": cart["cart_id"],
                "product_id": product["product_id"],
                "product_name": product["product_name"],
                "quantity": 1,
                "unit_price": float(product["price"]),
                "cart_total": float(total),
            })

        # ====================================================
        # CONFIRM CART -> ask for delivery city/state
        # ====================================================

        if intent == "confirm_cart":

            pending = self.get_pending_cart(customer_id, conversation_id)

            if isinstance(pending, dict) and "error" in pending:
                return self._result(False, "CONFIRM_CART", pending["error"], "PENDING_CART_LOOKUP_FAILED")

            if not pending:

                confirmed = self.get_confirmed_cart(customer_id, conversation_id)

                if isinstance(confirmed, dict) and "error" in confirmed:
                    return self._result(False, "CONFIRM_CART", confirmed["error"], "CONFIRMED_CART_LOOKUP_FAILED")

                if confirmed:

                    if confirmed.get("delivery_address"):
                        return self._result(True, "CONFIRM_CART", (
                            "Your cart is already confirmed. "
                            "Say 'proceed to payment' when you're ready."
                        ), data={"cart_id": confirmed["cart_id"], "cart_total": self.get_cart_total(confirmed["cart_id"], customer_id)})

                    return self._result(True, "CONFIRM_CART", (
                        "Your cart is already confirmed. "
                        "Which city and state should we deliver to?"
                    ), data={"cart_id": confirmed["cart_id"], "cart_total": self.get_cart_total(confirmed["cart_id"], customer_id)})

                return self._result(False, "CONFIRM_CART", "I couldn't find a pending cart to confirm.", "PENDING_CART_NOT_FOUND")

            cart_id = pending["cart_id"]

            result = self.confirm_cart(cart_id, customer_id)

            if "error" in result:
                return self._result(False, "CONFIRM_CART", result["error"], "CART_CONFIRMATION_FAILED")

            total = self.get_cart_total(cart_id, customer_id)

            if isinstance(total, dict):
                total = pending["price"] * pending["quantity"]

            return self._result(True, "CONFIRM_CART", (
                f"Your cart is confirmed for Rs.{float(total):.2f}.\n\n"
                f"Which city and state should we deliver to? "
                f"(e.g. \"Chennai, Tamil Nadu\")"
            ), data={"cart_id": cart_id, "cart_total": float(total)})

        # ====================================================
        # PROCEED TO PAYMENT (only after delivery location is set)
        # ====================================================

        if intent == "goto_payment":

            confirmed = self.get_confirmed_cart(customer_id, conversation_id)

            if isinstance(confirmed, dict) and "error" in confirmed:
                return self._result(False, "PAYMENT_FLOW", confirmed["error"], "CONFIRMED_CART_LOOKUP_FAILED")

            if not confirmed:
                return self._result(False, "PAYMENT_FLOW", "Please confirm your cart first.", "CONFIRMED_CART_NOT_FOUND")

            if not confirmed.get("delivery_address"):
                return self._result(False, "DELIVERY", "Please share your delivery city and state first.", "DELIVERY_ADDRESS_REQUIRED", {"cart_id": confirmed["cart_id"]})

            return self._result(True, "PAYMENT_FLOW", (
                "How would you like to pay?\n"
                "Credit Card, Debit Card, Net Banking, or Cash on Delivery."
            ), data={"cart_id": confirmed["cart_id"]})

        # ====================================================
        # PAYMENT METHOD SELECTED
        # ====================================================

        if intent == "payment_method":

            confirmed = self.get_confirmed_cart(customer_id, conversation_id)

            if isinstance(confirmed, dict) and "error" in confirmed:
                return self._result(False, "CREATE_PAYMENT_MANDATE", confirmed["error"], "CONFIRMED_CART_LOOKUP_FAILED")

            if not confirmed:
                return self._result(False, "CREATE_PAYMENT_MANDATE", "Please confirm your cart first.", "CONFIRMED_CART_NOT_FOUND")

            if not confirmed.get("delivery_address"):
                return self._result(False, "CREATE_PAYMENT_MANDATE", "Please share your delivery city and state before choosing a payment method.", "DELIVERY_ADDRESS_REQUIRED", {"cart_id": confirmed["cart_id"]})

            cart_id = confirmed["cart_id"]

            payment_type = self._extract_payment_type(message)

            if not payment_type:
                return self._result(False, "CREATE_PAYMENT_MANDATE", (
                    "Please choose a payment method: "
                    "Credit Card, Debit Card, Net Banking, or Cash on Delivery."
                ), "PAYMENT_TYPE_REQUIRED", {"cart_id": cart_id})

            mandate = self.create_payment_mandate(cart_id, customer_id, payment_type)

            if mandate.get("status") == "RISK_FLAGGED":
                return self._result(False, "CREATE_PAYMENT_MANDATE", "This payment requires additional verification and can't proceed automatically.", "RISK_FLAGGED", {"cart_id": cart_id, "status": "RISK_FLAGGED"})

            if "error" in mandate:
                return self._result(False, "CREATE_PAYMENT_MANDATE", mandate["error"], "PAYMENT_MANDATE_CREATION_FAILED", {"cart_id": cart_id})

            if mandate.get("status") != "PENDING":
                return self._result(False, "CREATE_PAYMENT_MANDATE", "Unable to create the payment authorization.", "PAYMENT_MANDATE_NOT_PENDING", {"cart_id": cart_id, "status": mandate.get("status")})

            amount = mandate["amount"]
            payment_label = payment_type.replace("_", " ").title()

            # Cash on Delivery: no extra details needed, process immediately.
            if payment_type == "cod":

                result = self.confirm_payment(cart_id, customer_id)

                if result.get("status") != "SUCCESS":
                    return self._result(False, "PAYMENT", f"Payment could not be completed.\n\n{result.get('error', 'Please try again.')}", "PAYMENT_FAILED", {"cart_id": cart_id, "mandate_id": result.get("mandate_id"), "amount": result.get("amount"), "payment_type": result.get("payment_type"), "status": result.get("status")})

                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

                return self._result(True, "PAYMENT", (
                    "Cash on Delivery confirmed.\n\n"
                    f"Amount: Rs.{float(result['amount']):.2f}\n"
                    f"Payment Method: {payment_label}\n"
                    f"Reference ID: {result['txn_id']}\n"
                    f"Confirmed at: {timestamp}\n\n"
                    "Would you like me to place the order?"
                ), data={"cart_id": cart_id, "mandate_id": result.get("mandate_id"), "transaction_id": result.get("txn_id"), "amount": result.get("amount"), "payment_type": result.get("payment_type"), "status": result.get("status")})

            # Card / Net Banking: ask for the corresponding detail.
            if payment_type in ("credit_card", "debit_card"):
                return self._result(True, "CREATE_PAYMENT_MANDATE", (
                    f"You selected {payment_label} for Rs.{float(amount):.2f}.\n\n"
                    "Please share your card number and expiry date "
                    "(demo only — not stored) to authorize payment."
                ), data={"cart_id": cart_id, "mandate_id": mandate.get("mandate_id"), "amount": amount, "payment_type": payment_type, "status": mandate.get("status")})

            if payment_type == "net_banking":
                return self._result(True, "CREATE_PAYMENT_MANDATE", (
                    f"You selected {payment_label} for Rs.{float(amount):.2f}.\n\n"
                    "Please share your UPI ID to authorize payment."
                ), data={"cart_id": cart_id, "mandate_id": mandate.get("mandate_id"), "amount": amount, "payment_type": payment_type, "status": mandate.get("status")})

            return self._result(False, "CREATE_PAYMENT_MANDATE", "Please provide the required payment details to continue.", "PAYMENT_DETAILS_REQUIRED", {"cart_id": cart_id, "mandate_id": mandate.get("mandate_id"), "amount": amount, "payment_type": payment_type, "status": mandate.get("status")})

        # ====================================================
        # UNKNOWN — contextual fallback:
        #   free text is treated as delivery details OR
        #   payment details, depending on where the customer is
        #   in the flow.
        # ====================================================

        confirmed = self.get_confirmed_cart(customer_id, conversation_id)

        if isinstance(confirmed, dict) and "error" in confirmed:
            return self._result(False, "GENERAL", confirmed["error"], "CONFIRMED_CART_LOOKUP_FAILED")

        if confirmed:

            cart_id = confirmed["cart_id"]
            address = confirmed.get("delivery_address")

            # --- Awaiting delivery city/state ---
            if not address:

                if self._looks_like_city_state(message):

                    saved = self.save_delivery_address(cart_id, customer_id, message.strip())

                    if "error" in saved:
                        return self._result(False, "DELIVERY", saved["error"], "DELIVERY_SAVE_FAILED", {"cart_id": cart_id, "delivery_address": message.strip()})

                    return self._result(True, "DELIVERY", (
                        f"Delivery location saved: {message.strip()}\n\n"
                        "Say 'proceed to payment' when you're ready to pay."
                    ), data={"cart_id": cart_id, "delivery_address": message.strip()})

                return self._result(True, "DELIVERY", (
                    "Which city and state should we deliver to? "
                    "(e.g. \"Chennai, Tamil Nadu\")"
                ), data={"cart_id": cart_id})

            # --- Awaiting card / UPI details for a PENDING mandate ---
            def _get_pending_mandate():

                conn = self._connect()

                try:

                    cursor = conn.cursor()

                    cursor.execute(
                        f"""
                        SELECT payment_type, amount
                        FROM ap2_ecommerce.gold.payment_mandates
                        WHERE cart_id = '{self._escape_sql(cart_id)}'
                          AND customer_id = '{self._escape_sql(customer_id)}'
                          AND status = 'PENDING'
                        ORDER BY created_at DESC
                        LIMIT 1
                        """
                    )

                    row = cursor.fetchone()

                    if not row:
                        return None

                    return {"payment_type": row[0], "amount": float(row[1])}

                finally:

                    cursor.close()
                    conn.close()

            pending_mandate = self._with_retry(_get_pending_mandate)

            has_pending_mandate = (
                isinstance(pending_mandate, dict)
                and "payment_type" in pending_mandate
            )

            if has_pending_mandate:

                payment_type = pending_mandate["payment_type"]

                # Treat this free-text message as the card/UPI detail,
                # then immediately process the payment.
                result = self.confirm_payment(cart_id, customer_id)

                if result.get("status") != "SUCCESS":
                    return self._result(False, "PAYMENT", (
                        "Payment could not be completed.\n\n"
                        f"{result.get('error', 'Please check the details and try again.')}"
                    ), "PAYMENT_FAILED", {"cart_id": cart_id, "mandate_id": result.get("mandate_id"), "amount": result.get("amount"), "payment_type": result.get("payment_type", payment_type), "status": result.get("status")})

                payment_label = payment_type.replace("_", " ").title()
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

                return self._result(True, "PAYMENT", (
                    "Payment successful.\n\n"
                    f"Amount: Rs.{float(result['amount']):.2f}\n"
                    f"Payment Method: {payment_label}\n"
                    f"Transaction ID: {result['txn_id']}\n"
                    f"Processed at: {timestamp}\n\n"
                    "Would you like me to place the order?"
                ), data={"cart_id": cart_id, "mandate_id": result.get("mandate_id"), "transaction_id": result.get("txn_id"), "amount": result.get("amount"), "payment_type": result.get("payment_type", payment_type), "status": result.get("status")})

        return self._result(True, "GENERAL", (
            "I can help you add products to your cart, confirm your cart, "
            "save your delivery location, choose a payment method, complete "
            "payment, place orders, and track your delivery."
        ))

        # ====================================================
        # CREATE ORDER
        # ====================================================

    def _handle_create_order(self, customer_id, conversation_id):

        confirmed = self.get_confirmed_cart(customer_id, conversation_id)

        if isinstance(confirmed, dict) and "error" in confirmed:
            return self._result(False, "CREATE_ORDER", confirmed["error"], "CONFIRMED_CART_LOOKUP_FAILED")

        if not confirmed:
            return self._result(False, "CREATE_ORDER", "I couldn't find a confirmed cart for this conversation.", "CONFIRMED_CART_NOT_FOUND")

        cart_id = confirmed["cart_id"]

        if not confirmed.get("delivery_address"):
            return self._result(False, "CREATE_ORDER", "Please share your delivery city and state before placing the order.", "DELIVERY_ADDRESS_REQUIRED", {"cart_id": cart_id})

        result = self.create_order(cart_id, customer_id)

        if "error" in result:
            return self._result(False, "CREATE_ORDER", result["error"], "ORDER_CREATION_FAILED", {"cart_id": cart_id})

        payment_label = str(result.get("payment_type", "")).replace("_", " ").title()

        return self._result(True, "CREATE_ORDER", (
            "Order placed successfully!\n\n"
            f"Product(s): {result.get('product_name')}\n"
            f"Quantity: {result.get('quantity')}\n"
            f"Amount: Rs.{float(result.get('amount', 0)):.2f}\n"
            f"Payment Method: {payment_label}\n"
            f"Payment Status: {result.get('payment_status')}\n"
            f"Transaction ID: {result.get('txn_id')}\n"
            f"Order ID: {result.get('order_id')}\n"
            f"Delivery Location: {result.get('delivery_address')}\n"
            f"Tracking ID: {result.get('tracking_id')}\n"
            f"Estimated Delivery: 3 days from today\n\n"
            "You can ask me to track this order anytime."
        ), data={
            "order_id": result.get("order_id"),
            "cart_id": result.get("cart_id", cart_id),
            "transaction_id": result.get("txn_id"),
            "tracking_id": result.get("tracking_id"),
            "amount": result.get("amount"),
            "payment_type": result.get("payment_type"),
            "delivery_address": result.get("delivery_address"),
            "status": result.get("status"),
        })

    def _handle_order_status(self, customer_id):

        order = self.get_latest_order(customer_id)

        if not order:
            return self._result(False, "TRACK_ORDER", "I couldn't find any orders for your account.", "ORDER_NOT_FOUND")

        if isinstance(order, dict) and "error" in order:
            return self._result(False, "TRACK_ORDER", order["error"], "ORDER_LOOKUP_FAILED")

        delivery = self.get_delivery(order["order_id"])

        if isinstance(delivery, dict) and "error" in delivery:
            return self._result(False, "TRACK_ORDER", delivery["error"], "DELIVERY_LOOKUP_FAILED", {"order_id": order["order_id"]})

        response = (
            f"Order ID: {order['order_id']}\n"
            f"Order Status: {order['status']}\n"
            f"Amount: Rs.{order['amount']:.2f}\n"
            f"Transaction ID: {order.get('txn_id')}\n"
        )

        if delivery:
            response += (
                f"\nTracking ID: {delivery['tracking_id']}\n"
                f"Carrier: {delivery['carrier']}\n"
                f"Delivery Status: {delivery['delivery_status']}\n"
                f"Estimated Delivery: {delivery['estimated_delivery_date']}"
            )

        data = dict(order)
        if delivery:
            data.update(delivery)
        return self._result(True, "TRACK_ORDER", response, data=data)

    # ========================================================
    # PREDICT (public entry point)
    # ========================================================

    def predict(self, request):

        try:

            message = self._extract_user_message(request)

            if not message:
                return self._response(self._result(False, "GENERAL", "I didn't receive a message.", "MESSAGE_REQUIRED"))

            customer = self.resolve_customer_id(request)
            if "error" in customer:
                return self._response(self._result(
                    False,
                    "GENERAL",
                    customer["error"],
                    "CUSTOMER_ID_RESOLUTION_FAILED",
                ))
            customer_id = customer["customer_id"]

            conversation_id = self._get_conversation_id(request)
            if not conversation_id:
                if customer.get("authenticated"):
                    conversation_id = "supervisor:" + str(customer_id)
                else:
                    return self._response(self._result(
                        False,
                        "GENERAL",
                        "A conversation ID is required to process cart and checkout requests.",
                        "CONVERSATION_ID_REQUIRED",
                    ))

            schema = self.ensure_cart_conversation_column()
            if "error" in schema:
                return self._response(self._result(
                    False,
                    "GENERAL",
                    schema["error"],
                    "CART_SCHEMA_MIGRATION_FAILED",
                ))

            print("TransactionAgent received:", message)

            intent = self._detect_intent(message)

            if intent == "create_order":
                text = self._handle_create_order(customer_id, conversation_id)
            elif intent == "order_status":
                text = self._handle_order_status(customer_id)
            else:
                text = self._predict_inner(message, conversation_id, intent, customer_id)

            return self._response(text)

        except Exception as e:

            print("TransactionAgent predict error:", repr(e))

            return self._response(self._result(False, "GENERAL", "Something went wrong while processing the transaction request.", "TRANSACTION_ERROR"))

    # ========================================================
    # PREDICT STREAM
    # ========================================================

    def predict_stream(self, request):

        response = self.predict(request)

        for item in response.output:
            yield ResponsesAgentStreamEvent(
                type="response.output_item.done",
                item=item,
            )


# ============================================================
# CREATE AGENT
# ============================================================

transaction_agent = TransactionAgent()
print("TransactionAgent object created OK")
