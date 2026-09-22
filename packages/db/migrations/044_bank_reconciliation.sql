-- مغایرت بانکی — تطبیق تراکنش‌های بانکی با اسناد حسابداری
-- 044_bank_reconciliation.sql

CREATE TABLE IF NOT EXISTS bank_reconciliation (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account    text NOT NULL,             -- شماره حساب بانکی
  statement_date  date NOT NULL,             -- تاریخ صورتحساب
  description     text NOT NULL,
  amount_rial     bigint NOT NULL,           -- مبلغ از صورتحساب بانک
  direction       text NOT NULL CHECK (direction IN ('debit','credit')),
  matched         boolean NOT NULL DEFAULT false,
  journal_entry_id uuid NULL REFERENCES journal_entries(id),
  note            text NULL,
  reconciled_by   uuid NULL,
  reconciled_at   timestamptz NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_recon_account ON bank_reconciliation(bank_account, statement_date);
CREATE INDEX IF NOT EXISTS idx_bank_recon_unmatched ON bank_reconciliation(matched) WHERE NOT matched;

COMMENT ON TABLE bank_reconciliation IS 'صورتحساب بانک — برای مغایرت‌گیری با اسناد حسابداری';
COMMENT ON COLUMN bank_reconciliation.matched IS 'آیا با سند حسابداری تطبیق داده شده؟';