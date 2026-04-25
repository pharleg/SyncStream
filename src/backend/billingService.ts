import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { secrets } from '@wix/secrets';

export class BillingError extends Error {
  constructor(
    public code: 'SYNC_LIMIT_REACHED' | 'NO_CREDITS' | 'PLATFORM_NOT_AVAILABLE',
    message: string,
  ) {
    super(message);
    this.name = 'BillingError';
  }
}

interface CreditRow {
  instance_id: string;
  plan_tier: 'free' | 'pro';
  credits_remaining: number;
  reset_date: string;
}

const FREE_CREDITS = 25;
const PRO_CREDITS = 500;
const FREE_PRODUCT_LIMIT = 50;
const RESET_INTERVAL_DAYS = 30;

function creditQuota(tier: 'free' | 'pro'): number {
  return tier === 'pro' ? PRO_CREDITS : FREE_CREDITS;
}

let _client: SupabaseClient | null = null;

export function __resetClientForTesting(): void {
  _client = null;
}

async function getClient(): Promise<SupabaseClient> {
  if (_client) return _client;
  const url = (await secrets.getSecretValue('supabase_project_url')).value!;
  const key = (await secrets.getSecretValue('supabase_service_role')).value!;
  _client = createClient(url, key);
  return _client;
}

async function ensureRow(instanceId: string, db: SupabaseClient): Promise<CreditRow> {
  const { data, error } = await db
    .from('credit_balance')
    .select('*')
    .eq('instance_id', instanceId)
    .single();

  if (data) return data as CreditRow;

  const resetDate = new Date(Date.now() + RESET_INTERVAL_DAYS * 86_400_000).toISOString();
  const row: CreditRow = {
    instance_id: instanceId,
    plan_tier: 'free',
    credits_remaining: FREE_CREDITS,
    reset_date: resetDate,
  };
  await db.from('credit_balance').insert(row);
  return row;
}

async function getRow(instanceId: string, db: SupabaseClient): Promise<CreditRow> {
  let row = await ensureRow(instanceId, db);

  if (new Date() > new Date(row.reset_date)) {
    const newCredits = creditQuota(row.plan_tier);
    const newResetDate = new Date(Date.now() + RESET_INTERVAL_DAYS * 86_400_000).toISOString();
    await db
      .from('credit_balance')
      .update({ credits_remaining: newCredits, reset_date: newResetDate })
      .eq('instance_id', instanceId);
    row = { ...row, credits_remaining: newCredits, reset_date: newResetDate };
  }

  return row;
}

export async function getPlan(instanceId: string): Promise<'free' | 'pro'> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  return row.plan_tier;
}

export async function checkSyncLimit(
  instanceId: string,
  productCount: number,
): Promise<void> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.plan_tier === 'free' && productCount > FREE_PRODUCT_LIMIT) {
    throw new BillingError(
      'SYNC_LIMIT_REACHED',
      `Free plan is limited to ${FREE_PRODUCT_LIMIT} products. Upgrade to Pro for unlimited sync.`,
    );
  }
}

export async function checkPlatformAccess(
  instanceId: string,
  platform: 'gmc' | 'meta',
): Promise<void> {
  if (platform !== 'meta') return;
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.plan_tier === 'free') {
    throw new BillingError(
      'PLATFORM_NOT_AVAILABLE',
      'Meta sync requires a Pro plan.',
    );
  }
}

export async function deductCredit(instanceId: string): Promise<void> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  if (row.credits_remaining <= 0) {
    const resetOn = new Date(row.reset_date).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    });
    throw new BillingError(
      'NO_CREDITS',
      `No AI credits remaining. Resets on ${resetOn}.`,
    );
  }
  await db
    .from('credit_balance')
    .update({ credits_remaining: row.credits_remaining - 1 })
    .eq('instance_id', instanceId);
}

export async function getCreditBalance(
  instanceId: string,
): Promise<{ remaining: number; resetDate: Date }> {
  const db = await getClient();
  const row = await getRow(instanceId, db);
  return { remaining: row.credits_remaining, resetDate: new Date(row.reset_date) };
}

export async function setPlanTier(
  instanceId: string,
  tier: 'free' | 'pro',
): Promise<void> {
  const db = await getClient();
  await ensureRow(instanceId, db);
  await db
    .from('credit_balance')
    .update({ plan_tier: tier })
    .eq('instance_id', instanceId);
}
