-- Личная история MVP. Не изменяет старые таблицы и демонстрационные записи.
CREATE TABLE IF NOT EXISTS public.rg_personal_records (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('checkin','training')),
 entry_key TEXT NOT NULL,
 payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (user_id, kind, entry_key)
);
ALTER TABLE public.rg_personal_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_personal_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rg_personal_records TO authenticated;
-- Политика применяется даже при прямом запросе в API Supabase в обход Python.
CREATE POLICY personal_owner ON public.rg_personal_records
 FOR ALL TO authenticated
 USING ((SELECT auth.uid()) = user_id)
 WITH CHECK ((SELECT auth.uid()) = user_id);
