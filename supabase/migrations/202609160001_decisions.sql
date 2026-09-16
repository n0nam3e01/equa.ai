-- Выполнить один раз в SQL Editor проекта Supabase.
-- PostgreSQL сохраняет исходные данные и объяснение вместе для аудита решения.
CREATE TABLE IF NOT EXISTS public.decisions (
    id UUID PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    transaction_data JSONB NOT NULL,
    policy_data JSONB NOT NULL,
    result_data JSONB NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('approve', 'challenge', 'block')),
    challenge_outcome TEXT CHECK (challenge_outcome IN ('passed', 'failed'))
);
CREATE INDEX IF NOT EXISTS decisions_created_at_idx ON public.decisions(created_at DESC);
-- Доступ только у Python-бэкенда с service_role. Публичный браузер ключ не получает.
ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.decisions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.decisions TO service_role;
COMMENT ON TABLE public.decisions IS 'Тестовые антифрод-решения equa.ai; не банковские операции';
