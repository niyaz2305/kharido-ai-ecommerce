import React, { memo, useState } from 'react';
import { AnimatedAssistantIcon } from './animation-assistant-icon';
import { Response } from './elements/response';
import { MessageContent } from './elements/message';
import {
  ChatProductResults,
  type ChatProduct,
} from './chat-product-results';
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
  type ToolState,
} from './elements/tool';
import {
  McpTool,
  McpToolHeader,
  McpToolContent,
  McpToolInput,
  McpApprovalActions,
} from './elements/mcp-tool';
import { MessageActions } from './message-actions';
import { PreviewAttachment } from './preview-attachment';
import equal from 'fast-deep-equal';
import { cn, sanitizeText } from '@/lib/utils';
import { MessageEditor } from './message-editor';
import { MessageReasoning } from './message-reasoning';
import { Shimmer } from './ui/shimmer';
import type { UseChatHelpers } from '@ai-sdk/react';
import type { ChatMessage, Feedback } from '@chat-template/core';
import { useDataStream } from './data-stream-provider';
import {
  createMessagePartSegments,
  formatNamePart,
  isNamePart,
  joinMessagePartSegments,
} from './databricks-message-part-transformers';
import { MessageError } from './message-error';
import { MessageOAuthError } from './message-oauth-error';
import { isCredentialErrorMessage } from '@/lib/oauth-error-utils';
import {
  groupConsecutiveToolSegments,
  type ChatPart,
  type ToolPart,
} from '@/lib/tool-group-segments';
import { Streamdown } from 'streamdown';
import { useApproval } from '@/hooks/use-approval';

// Matches markdown table columns by header NAME rather than fixed position,
// so this keeps working even if Genie changes column order or adds/drops
// an index column.
const PRODUCT_HEADER_ALIASES: Record<string, string> = {
  product_id: 'product_id',
  product_name: 'product_name',
  name: 'product_name',
  product_description: 'product_description',
  description: 'product_description',
  category: 'category',
  brand: 'brand',
  pack_size_or_quantity: 'pack_size_or_quantity',
  mrp: 'mrp',
  selling_price: 'selling_price',
  price: 'selling_price',
  discount_percent: 'discount_percent',
  discount: 'discount_percent',
  seller: 'seller',
  availability: 'availability',
  asin: 'asin',
  image_url: 'image_url',
  image: 'image_url',
};

function splitTableRow(line: string): string[] {
  return line.split('|').map((value) => value.replace(/\*\*/g, '').trim());
}

function parseProductTable(text: string): {
  products: ChatProduct[];
  cleanText: string;
} {
  const lines = text.split('\n');

  const tableStartIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase();

    return (
      normalized.includes('product_id') &&
      (normalized.includes('product_name') ||
        normalized.includes('selling_price'))
    );
  });

  if (tableStartIndex === -1) {
    return {
      products: [],
      cleanText: cleanAssistantText(text),
    };
  }

  const headerCells = splitTableRow(lines[tableStartIndex]).map((cell) =>
    cell.toLowerCase(),
  );

  // Map: canonical field name -> column index in this table
  const columnIndex: Record<string, number> = {};

  headerCells.forEach((cell, idx) => {
    const canonical = PRODUCT_HEADER_ALIASES[cell];
    if (canonical && columnIndex[canonical] === undefined) {
      columnIndex[canonical] = idx;
    }
  });

  // Need at minimum an id and something to show as a name/price.
  if (
    columnIndex.product_id === undefined ||
    (columnIndex.product_name === undefined &&
      columnIndex.selling_price === undefined)
  ) {
    return {
      products: [],
      cleanText: cleanAssistantText(text),
    };
  }

  const products: ChatProduct[] = [];

  let rowIndex = tableStartIndex + 1;

  const getCell = (values: string[], field: string): string | undefined => {
    const idx = columnIndex[field];
    if (idx === undefined) return undefined;
    return values[idx];
  };

  const getNumber = (values: string[], field: string): number | undefined => {
    const raw = getCell(values, field);
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw.replace(/,/g, ''));
    return Number.isNaN(n) ? undefined : n;
  };

  while (rowIndex < lines.length) {
    const line = lines[rowIndex].trim();

    if (!line.startsWith('|')) {
      rowIndex += 1;
      continue;
    }

    // Skip Markdown separator rows
    if (/^[|\s:-]+$/.test(line)) {
      rowIndex += 1;
      continue;
    }

    const values = splitTableRow(line);

    const productId = getCell(values, 'product_id');

    if (!productId || productId.toLowerCase() === 'product_id') {
      rowIndex += 1;
      continue;
    }

    const sellingPrice = getNumber(values, 'selling_price');

    // A row without a usable price isn't a real product row.
    if (sellingPrice === undefined) {
      rowIndex += 1;
      continue;
    }

    products.push({
      product_id: productId,
      product_name:
        getCell(values, 'product_name') || 'Unnamed product',
      product_description: getCell(values, 'product_description'),
      category: getCell(values, 'category') || 'other',
      brand: getCell(values, 'brand'),
      pack_size_or_quantity: getCell(values, 'pack_size_or_quantity'),
      mrp: getNumber(values, 'mrp'),
      selling_price: sellingPrice,
      discount_percent: getNumber(values, 'discount_percent'),
      seller: getCell(values, 'seller'),
      availability: getCell(values, 'availability'),
      asin: getCell(values, 'asin'),
      image_url: getCell(values, 'image_url'),
    });

    rowIndex += 1;
  }

  if (products.length === 0) {
    return {
      products: [],
      cleanText: cleanAssistantText(text),
    };
  }

  // Remove the complete raw Genie table from the assistant message.
  const remainingLines = [
    ...lines.slice(0, tableStartIndex),
  ];

  let afterTableIndex = rowIndex;

  while (
    afterTableIndex < lines.length &&
    lines[afterTableIndex].trim().startsWith('|')
  ) {
    afterTableIndex += 1;
  }

  remainingLines.push(
    ...lines.slice(afterTableIndex),
  );

  const cleanText = cleanAssistantText(
    remainingLines.join('\n'),
  );

  return {
    products,
    cleanText,
  };
}

function cleanAssistantText(text: string) {
  return text
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();

      if (
        trimmed.startsWith('# genie-') ||
        trimmed.startsWith('# Shopping_Supervisor')
      ) {
        return false;
      }

      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type TransactionResult = {
  success: boolean;
  operation: string;
  message?: string;
  details: Array<{
    label: string;
    value: string;
  }>;
};

function formatInr(value: unknown): string {
  const amount =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/,/g, ''))
        : Number.NaN;

  if (Number.isNaN(amount)) {
    return String(value ?? '');
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

function parseTransactionResult(text: string): TransactionResult | null {
  const trimmed = text.trim();

  const jsonText =
    trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i)?.[1] ??
    trimmed;

  // Existing JSON transaction format
  try {
    const parsed: unknown = JSON.parse(jsonText);

    if (
      parsed &&
      typeof parsed === 'object' &&
      'success' in parsed &&
      'operation' in parsed
    ) {
      const result = parsed as {
        success?: unknown;
        operation?: unknown;
        message?: unknown;
        data?: Record<string, unknown>;
      };

      if (
        typeof result.success === 'boolean' &&
        typeof result.operation === 'string'
      ) {
        const data = result.data ?? {};

        const details = [
          ['product_name', 'Product Name', data.product_name],
          ['quantity', 'Quantity', data.quantity],
          ['unit_price', 'Unit Price', data.unit_price],
          ['cart_total', 'Cart Total', data.cart_total],
          ['payment_method', 'Payment Method', data.payment_method],
          ['payment_status', 'Payment Status', data.payment_status],
          ['order_status', 'Order Status', data.order_status],
          ['estimated_delivery', 'Estimated Delivery', data.estimated_delivery],
        ]
          .filter(
            ([, , value]) =>
              value !== undefined && value !== null && value !== '',
          )
          .map(([key, label, value]) => ({
            label,
            value:
              key === 'unit_price' || key === 'cart_total'
                ? formatInr(value)
                : String(value),
          }));

        return {
          success: result.success,
          operation: result.operation,
          message:
            typeof result.message === 'string' ? result.message : undefined,
          details,
        };
      }
    }
  } catch {
    // Not JSON. Try TRANSACTION_RESULT format below.
  }

  // Current TransactionAgent TRANSACTION_RESULT format
  if (!/^TRANSACTION_RESULT\b/i.test(trimmed)) {
    return null;
  }

  const getField = (field: string): string | undefined => {
    const match = trimmed.match(
      new RegExp(
        `(?:^|\\s)${field}:\\s*([\\s\\S]*?)(?=\\s+(?:Success|Operation|Error Code|Message|Price|Cart total|Would you like|Cart Id|Product Id|Product Name|Quantity|Unit Price|Total|$))`,
        'i',
      ),
    );

    return match?.[1]?.trim() || undefined;
  };

  const successMatch = trimmed.match(/\bSuccess:\s*(Yes|No)\b/i);
  const operationMatch = trimmed.match(/\bOperation:\s*([A-Z_]+)\b/i);

  if (!successMatch || !operationMatch) {
    return null;
  }

  const success = successMatch[1].toLowerCase() === 'yes';
  const operation = operationMatch[1];

  const message = getField('Message');

  const details: Array<{ label: string; value: string }> = [];

  const productName = getField('Product Name');
  const quantity = getField('Quantity');
  const unitPrice = getField('Unit Price');
  const cartTotal = getField('Cart Total');

  if (productName) {
    details.push({
      label: 'Product Name',
      value: productName,
    });
  }

  if (quantity) {
    details.push({
      label: 'Quantity',
      value: quantity,
    });
  }

  if (unitPrice) {
    details.push({
      label: 'Unit Price',
      value: formatInr(unitPrice),
    });
  }

  if (cartTotal) {
    details.push({
      label: 'Cart Total',
      value: formatInr(cartTotal),
    });
  }

  const paymentMethod = getField('Payment Method');
  const paymentStatus = getField('Payment Status');
  const orderStatus = getField('Order Status');
  const estimatedDelivery = getField('Estimated Delivery');

  if (paymentMethod) {
    details.push({
      label: 'Payment Method',
      value: paymentMethod,
    });
  }

  if (paymentStatus) {
    details.push({
      label: 'Payment Status',
      value: paymentStatus,
    });
  }

  if (orderStatus) {
    details.push({
      label: 'Order Status',
      value: orderStatus,
    });
  }

  if (estimatedDelivery) {
    details.push({
      label: 'Estimated Delivery',
      value: estimatedDelivery,
    });
  }

  return {
    success,
    operation,
    message,
    details,
  };
}

const PurePreviewMessage = ({
  message,
  allMessages,
  isLoading,
  setMessages,
  addToolApprovalResponse,
  sendMessage,
  regenerate,
  isReadonly,
  requiresScrollPadding,
  initialFeedback,
}: {
  message: ChatMessage;
  allMessages: ChatMessage[];
  isLoading: boolean;
  setMessages: UseChatHelpers<ChatMessage>['setMessages'];
  addToolApprovalResponse: UseChatHelpers<ChatMessage>['addToolApprovalResponse'];
  sendMessage: UseChatHelpers<ChatMessage>['sendMessage'];
  regenerate: UseChatHelpers<ChatMessage>['regenerate'];
  isReadonly: boolean;
  requiresScrollPadding: boolean;
  initialFeedback?: Feedback;
}) => {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [showErrors, setShowErrors] = useState(false);

  // Hook for handling MCP approval requests
  const { submitApproval, isSubmitting, pendingApprovalId } = useApproval({
    addToolApprovalResponse,
    sendMessage,
  });

  const attachmentsFromMessage = message.parts.filter(
    (part) => part.type === 'file',
  );

  // Extract non-OAuth error parts separately (OAuth errors are rendered inline)
  const errorParts = React.useMemo(
    () =>
      message.parts
        .filter((part) => part.type === 'data-error')
        .filter((part) => {
          // OAuth errors are rendered inline, not in the error section
          return !isCredentialErrorMessage(part.data);
        }),
    [message.parts],
  );

  useDataStream();

  const partSegments = React.useMemo(
    /**
     * We segment message parts into segments that can be rendered as a single component.
     * Used to render citations as part of the associated text.
     * Note: OAuth errors are included here for inline rendering, non-OAuth errors are filtered out.
     */
    () =>
      createMessagePartSegments(
        message.parts.filter(
          (part) =>
            part.type !== 'data-error' || isCredentialErrorMessage(part.data),
        ),
      ),
    [message.parts],
  );

  const renderBlocks = React.useMemo(() => {
  const filteredSegments = partSegments.filter((segment) => {
    const part = segment[0];

    if (
      part?.type === 'dynamic-tool' &&
      part.toolName?.startsWith('genie-')
    ) {
      return false;
    }

    return true;
  });

  return groupConsecutiveToolSegments(filteredSegments);
}, [partSegments]);

  // Check if message only contains non-OAuth errors (no other content)
  const hasOnlyErrors = React.useMemo(() => {
    const nonErrorParts = message.parts.filter(
      (part) => part.type !== 'data-error',
    );
    // Only consider non-OAuth errors for this check
    return errorParts.length > 0 && nonErrorParts.length === 0;
  }, [message.parts, errorParts.length]);

  return (
    <div
      data-testid={`message-${message.role}`}
      className="group/message w-full"
      data-role={message.role}
    >
      <div
        className={cn('flex w-full items-start gap-2 md:gap-3', {
          'justify-end': message.role === 'user',
          'justify-start': message.role === 'assistant',
        })}
      >
        {partSegments.length === 0 && errorParts.length === 0 && message.role === 'assistant' && (
          <AwaitingResponseMessage />
        )}

        <div
          className={cn('flex min-w-0 flex-col gap-3', {
            'w-full': message.role === 'assistant' || mode === 'edit',
            'min-h-96': message.role === 'assistant' && requiresScrollPadding,
            'max-w-[70%] sm:max-w-[min(fit-content,80%)]':
              message.role === 'user' && mode !== 'edit',
          })}
        >
          {attachmentsFromMessage.length > 0 && (
            <div
              data-testid={`message-attachments`}
              className={cn('flex flex-row justify-end gap-2', {
                'justify-start': message.role === 'assistant',
              })}
            >
              {attachmentsFromMessage.map((attachment) => (
                <PreviewAttachment
                  key={attachment.url}
                  attachment={{
                    name: attachment.filename ?? 'file',
                    contentType: attachment.mediaType,
                    url: attachment.url,
                  }}
                />
              ))}
            </div>
          )}

          {renderBlocks.map((block) => {
            if (block.kind === 'tool-group') {
              return (
                <MessageToolGroup
                  key={`tool-group-${block.startIndex}`}
                  tools={block.tools}
                  isLoading={isLoading}
                  submitApproval={submitApproval}
                  isSubmitting={isSubmitting}
                  pendingApprovalId={pendingApprovalId}
                />
              );
            }

            const parts = block.parts;
            const index = block.index;
            const [part] = parts;
            const { type } = part;
            const key = `message-${message.id}-part-${index}`;

            if (type === 'reasoning' && part.text?.trim().length > 0) {
              return (
                <MessageReasoning
                  key={key}
                  isLoading={isLoading}
                  reasoning={part.text}
                />
              );
            }

            if (type === 'text') {
              if (isNamePart(part)) {
                return null;
              }

              if (mode === 'view') {
                const rawText = joinMessagePartSegments(parts);

                const transactionResult = parseTransactionResult(rawText);

                const {
                  products,
                  cleanText,
                } = parseProductTable(rawText);

                return (
                  <div key={key} className="flex flex-col gap-3">
                    {transactionResult ? (
  <MessageContent
    data-testid="message-content"
    className="bg-transparent px-0 py-0 text-left text-base"
  >
    <div className="space-y-1">
      <div>Success: {transactionResult.success ? 'Yes' : 'No'}</div>
      <div>Operation: {transactionResult.operation}</div>

      {transactionResult.message && (
        <div>Message: {transactionResult.message}</div>
      )}

      {transactionResult.details.length > 0 && (
        <div className="pt-2">
          {transactionResult.details.map((detail) => (
            <div key={detail.label}>
              {detail.label}: {detail.value}
            </div>
          ))}
        </div>
      )}
    </div>
  </MessageContent>
) : (
  cleanText && (
    <MessageContent
      data-testid="message-content"
      className={cn({
        'bg-secondary w-fit break-words rounded-2xl px-3 py-2 text-left text-base':
          message.role === 'user',
        'bg-transparent px-0 py-0 text-left text-base':
          message.role === 'assistant',
      })}
    >
      <Response>{sanitizeText(cleanText)}</Response>
    </MessageContent>
  )
)}

                    {message.role === 'assistant' &&
                      products.length > 0 && (
                        <ChatProductResults
                          products={products.slice(0, 20)}
                        />
                      )}
                  </div>
                );
              }

  if (mode === 'edit') {
    return (
      <div
        key={key}
        className="flex w-full flex-row items-start gap-3"
      >
        <div className="size-8" />

        <div className="min-w-0 flex-1">
          <MessageEditor
            key={message.id}
            message={message}
            setMode={setMode}
            setMessages={setMessages}
            regenerate={regenerate}
          />
        </div>
      </div>
    );
  }
}
            // dynamic-tool parts are rendered by MessageToolGroup above.

            // Support for citations/annotations
            if (type === 'source-url') {
              return (
                <a
                  key={key}
                  href={part.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-baseline text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  <sup className="text-xs">[{part.title || part.url}]</sup>
                </a>
              );
            }

            // Render OAuth errors inline
            if (type === 'data-error' && isCredentialErrorMessage(part.data)) {
              return (
                <MessageOAuthError
                  key={key}
                  error={part.data}
                  allMessages={allMessages}
                  setMessages={setMessages}
                  sendMessage={sendMessage}
                />
              );
            }
          })}

          {!isReadonly && !hasOnlyErrors && (
            <MessageActions
              key={`action-${message.id}`}
              message={message}
              isLoading={isLoading}
              setMode={setMode}
              errorCount={errorParts.length}
              showErrors={showErrors}
              onToggleErrors={() => setShowErrors(!showErrors)}
              initialFeedback={initialFeedback}
            />
          )}

          {errorParts.length > 0 && (hasOnlyErrors || showErrors) && (
            <div className="flex flex-col gap-2">
              {errorParts.map((part, index) => (
                <MessageError
                  key={`error-${message.id}-${index}`}
                  error={part.data}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const PreviewMessage = memo(
  PurePreviewMessage,
  (prevProps, nextProps) => {
    if (prevProps.isLoading !== nextProps.isLoading) return false;
    // While streaming, re-render whenever the AI SDK produces a new message
    // object (each throttled update). We use reference equality rather than
    // deep-equal on parts because fast-deep-equal short-circuits on identical
    // references — and the SDK may mutate parts in place during streaming.
    if (nextProps.isLoading && prevProps.message !== nextProps.message)
      return false;

    if (prevProps.message.id !== nextProps.message.id) return false;
    if (prevProps.requiresScrollPadding !== nextProps.requiresScrollPadding)
      return false;
    if (!equal(prevProps.message.parts, nextProps.message.parts)) return false;
    if (prevProps.initialFeedback?.feedbackType !== nextProps.initialFeedback?.feedbackType)
      return false;

    return true; // Props are equal, skip re-render
  },
);


const MessageToolGroup = ({
  tools,
  isLoading,
  submitApproval,
  isSubmitting,
  pendingApprovalId,
}: {
  tools: ToolPart[];
  isLoading: boolean;
  submitApproval: ReturnType<typeof useApproval>['submitApproval'];
  isSubmitting: boolean;
  pendingApprovalId: string | null;
}) => {
  const isMultiple = tools.length > 1;
  return (
    <div
      className={cn('flex flex-col gap-2', {
        'rounded-md border border-border/60 bg-muted/20 p-2': isMultiple,
      })}
      data-testid={isMultiple ? 'tool-group' : undefined}
    >
      {tools.map((tool) => (
        <ToolPartRenderer
          key={tool.toolCallId}
          part={tool}
          isLoading={isLoading}
          submitApproval={submitApproval}
          isSubmitting={isSubmitting}
          pendingApprovalId={pendingApprovalId}
        />
      ))}
    </div>
  );
};

const ToolPartRenderer = ({
  part,
  isLoading,
  submitApproval,
  isSubmitting,
  pendingApprovalId,
}: {
  part: ToolPart;
  isLoading: boolean;
  submitApproval: ReturnType<typeof useApproval>['submitApproval'];
  isSubmitting: boolean;
  pendingApprovalId: string | null;
}) => {

const { toolCallId, input, state, errorText, output, toolName } = part;

console.log('[GENIE DEBUG PART]', {
  type: part.type,
  toolName,
  state,
  providerExecuted: part.providerExecuted,
  input,
  output,
  part,
});

const isGenieTool = toolName.startsWith('genie-');

if (isGenieTool) {
  return null;
}

console.log('[Approval Tool Input]', {
  toolName,
  input,
  state,
});

  if (state === 'output-available') {
    console.log('[COMPLETED TOOL OUTPUT]', {
    toolName,
    output,
  });
}

  const isMcpApproval =
    part.callProviderMetadata?.databricks?.approvalRequestId != null;
  const mcpServerName =
    part.callProviderMetadata?.databricks?.mcpServerName?.toString();

  const approved: boolean | undefined =
    'approval' in part ? part.approval?.approved : undefined;

  const effectiveState: ToolState = (() => {
    if (part.providerExecuted && !isLoading && state === 'input-available') {
      return 'output-available';
    }
    return state;
  })();

  if (isMcpApproval) {
    return (
      <McpTool defaultOpen={true}>
        <McpToolHeader
          serverName={mcpServerName}
          toolName={toolName}
          state={effectiveState}
          approved={approved}
        />
        <McpToolContent>
          <McpToolInput input={input} />
          {state === 'approval-requested' && (
            <McpApprovalActions
              onApprove={() =>
                submitApproval({ approvalRequestId: toolCallId, approve: true })
              }
              onDeny={() =>
                submitApproval({
                  approvalRequestId: toolCallId,
                  approve: false,
                })
              }
              isSubmitting={isSubmitting && pendingApprovalId === toolCallId}
            />
          )}
          {state === 'output-available' && output != null && (
            <ToolOutput
              output={
                errorText ? (
                  <div className="rounded border p-2 text-red-500">
                    Error: {errorText}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap font-mono text-sm">
                    {typeof output === 'string'
                      ? output
                      : JSON.stringify(output, null, 2)}
                  </div>
                )
              }
              errorText={undefined}
            />
          )}
        </McpToolContent>
      </McpTool>
    );
  }

  return (
  <Tool defaultOpen={true}>
    <ToolHeader type={toolName} state={effectiveState} />
    <ToolContent>
      <ToolInput input={input} />

      {state === 'output-available' && errorText && (
        <ToolOutput
          output={
            <div className="rounded border p-2 text-red-500">
              Error: {errorText}
            </div>
          }
          errorText={undefined}
        />
      )}
    </ToolContent>
  </Tool>
);
};

export const AwaitingResponseMessage = () => {
  const role = 'assistant';

  return (
    <div
      data-testid="message-assistant-loading"
      className="group/message w-full"
      data-role={role}
    >
      <div className="flex items-start justify-start gap-3">
        <Shimmer className="flex items-center">Generating response</Shimmer>
      </div>
    </div>
  );
};
