-- Выполнить в SQL Editor. Старые таблицы equa.ai не затрагиваются.
CREATE TABLE IF NOT EXISTS public.rg_workspaces (
 id UUID PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.rg_records (
 id UUID PRIMARY KEY, workspace_id UUID NOT NULL REFERENCES public.rg_workspaces(id) ON DELETE CASCADE,
 player_id TEXT NOT NULL CHECK (player_id IN ('alex','mira','timur')),
 kind TEXT NOT NULL CHECK (kind IN ('checkin','training','lesson','decision')),
 payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rg_records_workspace ON public.rg_records(workspace_id, player_id, kind);
ALTER TABLE public.rg_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_workspaces, public.rg_records FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.rg_workspaces TO service_role;
GRANT SELECT, INSERT, DELETE ON public.rg_records TO service_role;
-- Браузер не получает service_role. API фильтрует каждый запрос по workspace_id.
