import { describe, it, expect, beforeEach, vi } from 'vitest';

// Hoist mock variables so they are available inside vi.mock() factory callbacks
const { mockSingle, mockUpdate, mockInsert, mockSelect, mockFrom } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockUpdate = vi.fn().mockReturnValue({ error: null });
  const mockInsert = vi.fn().mockReturnValue({ error: null });
  const mockSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
  const mockFrom = vi.fn().mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  });
  return { mockSingle, mockUpdate, mockInsert, mockSelect, mockFrom };
});

// Mock @wix/secrets before importing billingService
vi.mock('@wix/secrets', () => ({
  secrets: {
    getSecretValue: vi.fn().mockResolvedValue({ value: 'mock-value' }),
  },
}));

// Mock @supabase/supabase-js
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue({ from: mockFrom }),
}));

import {
  getPlan,
  checkSyncLimit,
  checkPlatformAccess,
  deductCredit,
  getCreditBalance,
  BillingError,
  __resetClientForTesting,
} from './billingService';

const FUTURE_RESET = new Date('2026-05-24T12:00:00Z').toISOString();
const PAST_RESET = new Date('2026-03-24T12:00:00Z').toISOString();

function mockRow(overrides: Partial<{
  plan_tier: string;
  credits_remaining: number;
  reset_date: string;
}> = {}) {
  return {
    instance_id: 'test-instance',
    plan_tier: 'free',
    credits_remaining: 25,
    reset_date: FUTURE_RESET,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetClientForTesting();
  // Restore mockFrom's implementation (may be overridden by lazy init test)
  mockFrom.mockReturnValue({
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  });
  mockSelect.mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) });
  // Default: row exists with Free plan and 25 credits
  mockSingle.mockResolvedValue({ data: mockRow(), error: null });
  mockUpdate.mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  mockInsert.mockResolvedValue({ error: null });
});

describe('getPlan', () => {
  it('returns free when plan_tier is free', async () => {
    expect(await getPlan('test-instance')).toBe('free');
  });

  it('returns pro when plan_tier is pro', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    expect(await getPlan('test-instance')).toBe('pro');
  });
});

describe('checkSyncLimit', () => {
  it('throws SYNC_LIMIT_REACHED when free plan has more than 50 products', async () => {
    await expect(checkSyncLimit('test-instance', 51))
      .rejects.toMatchObject({ code: 'SYNC_LIMIT_REACHED' });
  });

  it('throws SYNC_LIMIT_REACHED at exactly 51 products on free', async () => {
    await expect(checkSyncLimit('test-instance', 51))
      .rejects.toBeInstanceOf(BillingError);
  });

  it('passes at exactly 50 products on free', async () => {
    await expect(checkSyncLimit('test-instance', 50)).resolves.toBeUndefined();
  });

  it('passes for pro plan with 10000 products', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    await expect(checkSyncLimit('test-instance', 10000)).resolves.toBeUndefined();
  });
});

describe('checkPlatformAccess', () => {
  it('throws PLATFORM_NOT_AVAILABLE for free plan trying meta', async () => {
    await expect(checkPlatformAccess('test-instance', 'meta'))
      .rejects.toMatchObject({ code: 'PLATFORM_NOT_AVAILABLE' });
  });

  it('passes for free plan accessing gmc', async () => {
    await expect(checkPlatformAccess('test-instance', 'gmc')).resolves.toBeUndefined();
  });

  it('passes for pro plan accessing meta', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ plan_tier: 'pro' }), error: null });
    await expect(checkPlatformAccess('test-instance', 'meta')).resolves.toBeUndefined();
  });
});

describe('deductCredit', () => {
  it('throws NO_CREDITS when credits_remaining is 0', async () => {
    mockSingle.mockResolvedValue({ data: mockRow({ credits_remaining: 0 }), error: null });
    await expect(deductCredit('test-instance'))
      .rejects.toMatchObject({ code: 'NO_CREDITS' });
  });

  it('calls update to decrement credits when credits > 0', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });
    await deductCredit('test-instance');
    expect(mockFrom).toHaveBeenCalledWith('credit_balance');
    expect(mockUpdate).toHaveBeenCalledWith({ credits_remaining: 24 });
    expect(updateEq).toHaveBeenCalledWith('instance_id', 'test-instance');
  });
});

describe('getCreditBalance', () => {
  it('returns remaining and resetDate', async () => {
    const result = await getCreditBalance('test-instance');
    expect(result.remaining).toBe(25);
    expect(result.resetDate).toBeInstanceOf(Date);
  });
});

describe('lazy init', () => {
  it('creates a free row when no row exists', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    const insertMock = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: mockSingle }) }),
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      insert: insertMock,
    });
    await getPlan('test-instance');
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ plan_tier: 'free', credits_remaining: 25 })
    );
  });
});

describe('monthly reset', () => {
  it('resets credits to tier quota when reset_date is in the past', async () => {
    mockSingle.mockResolvedValue({
      data: mockRow({ credits_remaining: 3, reset_date: PAST_RESET }),
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });

    const result = await getCreditBalance('test-instance');

    expect(result.remaining).toBe(25);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ credits_remaining: 25 })
    );
  });

  it('resets pro credits to 500 after billing period', async () => {
    mockSingle.mockResolvedValue({
      data: mockRow({ plan_tier: 'pro', credits_remaining: 10, reset_date: PAST_RESET }),
      error: null,
    });
    const updateEq = vi.fn().mockResolvedValue({ error: null });
    mockUpdate.mockReturnValue({ eq: updateEq });

    const result = await getCreditBalance('test-instance');
    expect(result.remaining).toBe(500);
  });
});
