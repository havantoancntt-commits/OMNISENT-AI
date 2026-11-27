/**
 * Institutional 13-State Order Lifecycle State Machine.
 * Enforces deterministic transitions and produces immutable audit event records.
 */

export type OrderLifecycleState =
  | 'CREATED'
  | 'VALIDATING'
  | 'RISK_REJECTED'
  | 'SUBMITTED'
  | 'ACKNOWLEDGED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'ERROR'
  | 'RECONCILIATION_REQUIRED';

export interface OrderStateEvent {
  id: string;
  orderId: string;
  fromState: OrderLifecycleState | null;
  toState: OrderLifecycleState;
  reason: string;
  actor: string;
  metadataJson?: string;
  timestampUtc: string;
}

export const ORDER_TERMINAL_STATES = new Set<OrderLifecycleState>([
  'RISK_REJECTED',
  'FILLED',
  'CANCELLED',
  'REJECTED',
  'EXPIRED',
]);

export const ORDER_STATE_TRANSITIONS: Record<OrderLifecycleState, readonly OrderLifecycleState[]> = {
  CREATED: ['VALIDATING', 'CANCELLED', 'ERROR'],
  VALIDATING: ['RISK_REJECTED', 'SUBMITTED', 'ERROR'],
  RISK_REJECTED: [],
  SUBMITTED: [
    'ACKNOWLEDGED',
    'PARTIALLY_FILLED',
    'FILLED',
    'REJECTED',
    'EXPIRED',
    'CANCEL_PENDING',
    'ERROR',
    'RECONCILIATION_REQUIRED',
  ],
  ACKNOWLEDGED: [
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCEL_PENDING',
    'CANCELLED',
    'EXPIRED',
    'REJECTED',
    'ERROR',
    'RECONCILIATION_REQUIRED',
  ],
  PARTIALLY_FILLED: [
    'PARTIALLY_FILLED',
    'FILLED',
    'CANCEL_PENDING',
    'CANCELLED',
    'EXPIRED',
    'ERROR',
    'RECONCILIATION_REQUIRED',
  ],
  FILLED: [],
  CANCEL_PENDING: ['CANCELLED', 'FILLED', 'PARTIALLY_FILLED', 'ERROR', 'RECONCILIATION_REQUIRED'],
  CANCELLED: [],
  REJECTED: [],
  EXPIRED: [],
  ERROR: ['RECONCILIATION_REQUIRED', 'CANCELLED', 'REJECTED'],
  RECONCILIATION_REQUIRED: ['FILLED', 'PARTIALLY_FILLED', 'CANCELLED', 'REJECTED', 'EXPIRED'],
};

export function canTransitionOrderState(
  fromState: OrderLifecycleState | null,
  toState: OrderLifecycleState,
): boolean {
  if (fromState === null) {
    return toState === 'CREATED';
  }
  return ORDER_STATE_TRANSITIONS[fromState].includes(toState);
}

export function transitionOrderState(params: {
  orderId: string;
  fromState: OrderLifecycleState | null;
  toState: OrderLifecycleState;
  reason: string;
  actor: string;
  metadata?: Record<string, unknown>;
  nowIso?: string;
}): OrderStateEvent {
  if (!canTransitionOrderState(params.fromState, params.toState)) {
    throw new Error(
      `Invalid order state transition for ${params.orderId}: ${params.fromState ?? 'NULL'} -> ${params.toState}`,
    );
  }
  const ts = params.nowIso ?? new Date().toISOString();
  return {
    id: `OSE-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    orderId: params.orderId,
    fromState: params.fromState,
    toState: params.toState,
    reason: params.reason,
    actor: params.actor,
    metadataJson: params.metadata ? JSON.stringify(params.metadata) : undefined,
    timestampUtc: ts,
  };
}

export function mapLifecycleToLegacyOrderStatus(
  state: OrderLifecycleState,
): 'FILLED' | 'REJECTED' | 'CANCELLED' | 'OPEN' {
  switch (state) {
    case 'FILLED':
      return 'FILLED';
    case 'RISK_REJECTED':
    case 'REJECTED':
    case 'ERROR':
      return 'REJECTED';
    case 'CANCELLED':
    case 'EXPIRED':
      return 'CANCELLED';
    default:
      return 'OPEN';
  }
}
