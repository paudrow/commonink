-- Paying for the hosted app (cloud/src/billing.ts): one row per person, made the first time billing
-- sees them, which starts their trial. Stripe's customer and subscription, as its webhooks last said.
CREATE TABLE billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  trial_ends INTEGER NOT NULL,
  customer_id TEXT UNIQUE,
  subscription_id TEXT,
  -- Stripe's subscription status (active, trialing, past_due, unpaid, canceled, incomplete, ...), or NULL for none yet.
  status TEXT,
  interval TEXT CHECK (interval IN ('month', 'year')),
  period_end INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
