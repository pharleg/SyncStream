CREATE TABLE IF NOT EXISTS credit_balance (
  instance_id       TEXT        PRIMARY KEY,
  plan_tier         TEXT        NOT NULL DEFAULT 'free'
                                CHECK (plan_tier IN ('free', 'pro')),
  credits_remaining INTEGER     NOT NULL DEFAULT 25,
  reset_date        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days')
);

ALTER TABLE credit_balance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON credit_balance
  FOR ALL USING (true) WITH CHECK (true);
