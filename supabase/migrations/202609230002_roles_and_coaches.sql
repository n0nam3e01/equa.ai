-- Роль фиксируется при создании пользователя. Пользовательский JWT/metadata позднее её не меняет.
BEGIN;
CREATE TABLE IF NOT EXISTS public.rg_profiles (
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK (role IN ('player','coach')),
 display_name TEXT NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
 coach_code TEXT UNIQUE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT coach_code_role CHECK ((role = 'coach') = (coach_code IS NOT NULL))
);
ALTER TABLE public.rg_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_profiles FROM anon, authenticated;
GRANT SELECT ON public.rg_profiles TO authenticated;
GRANT SELECT ON public.rg_profiles TO service_role;
CREATE POLICY rg_profile_self ON public.rg_profiles FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) = user_id);

-- Существующие аккаунты остаются игроками. Код тренера имеет 96 бит случайности.
INSERT INTO public.rg_profiles (user_id, role, display_name)
SELECT id, 'player', left(coalesce(nullif(trim(raw_user_meta_data->>'name'), ''), 'Игрок'), 60)
FROM auth.users ON CONFLICT (user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.rg_new_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE chosen_role text;
BEGIN
 chosen_role := CASE WHEN NEW.raw_user_meta_data->>'rg_role' = 'coach' THEN 'coach' ELSE 'player' END;
 INSERT INTO public.rg_profiles(user_id, role, display_name, coach_code)
 VALUES (NEW.id, chosen_role,
         left(coalesce(nullif(trim(NEW.raw_user_meta_data->>'name'), ''), 'Игрок'), 60),
         CASE WHEN chosen_role = 'coach' THEN replace(gen_random_uuid()::text, '-', '') ELSE NULL END);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS rg_on_auth_user_created ON auth.users;
CREATE TRIGGER rg_on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.rg_new_profile();
REVOKE ALL ON FUNCTION public.rg_new_profile() FROM PUBLIC, anon, authenticated;

-- Игрок может дать и отозвать доступ, но не может посмотреть чужие связи.
CREATE TABLE IF NOT EXISTS public.rg_coach_links (
 player_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 coach_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CONSTRAINT distinct_people CHECK (player_id <> coach_id)
);
CREATE INDEX IF NOT EXISTS rg_coach_links_coach ON public.rg_coach_links(coach_id);
ALTER TABLE public.rg_coach_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_coach_links FROM anon, authenticated;
GRANT SELECT, DELETE ON public.rg_coach_links TO authenticated;
GRANT SELECT ON public.rg_coach_links TO service_role;
CREATE POLICY rg_link_own ON public.rg_coach_links FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) IN (player_id, coach_id));
CREATE POLICY rg_link_player_revoke ON public.rg_coach_links FOR DELETE TO authenticated
 USING ((SELECT auth.uid()) = player_id);

-- Короткий теннисный контекст принадлежит игроку. Он влияет на подсказку и сводку.
CREATE TABLE IF NOT EXISTS public.rg_player_context (
 user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 level TEXT NOT NULL DEFAULT 'beginner' CHECK (level IN ('beginner','intermediate','advanced')),
 goal TEXT NOT NULL DEFAULT '' CHECK (char_length(goal) <= 120),
 sessions_per_week INT NOT NULL DEFAULT 2 CHECK (sessions_per_week BETWEEN 0 AND 14),
 next_match DATE,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rg_player_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_player_context FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rg_player_context TO authenticated;
GRANT SELECT ON public.rg_player_context TO service_role;
CREATE POLICY rg_context_self_read ON public.rg_player_context FOR SELECT TO authenticated
 USING ((SELECT auth.uid()) = user_id);
CREATE POLICY rg_context_self_write ON public.rg_player_context FOR INSERT TO authenticated
 WITH CHECK ((SELECT auth.uid()) = user_id AND EXISTS
 (SELECT 1 FROM public.rg_profiles WHERE user_id = auth.uid() AND role = 'player'));
CREATE POLICY rg_context_self_update ON public.rg_player_context FOR UPDATE TO authenticated
 USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

-- Вызов доступен только вошедшему игроку. Код тренера не раскрывает список тренеров.
CREATE OR REPLACE FUNCTION public.rg_join_coach(input_code text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE coach_row public.rg_profiles%ROWTYPE;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.rg_profiles WHERE user_id = auth.uid() AND role = 'player') THEN
  RAISE EXCEPTION 'Only players can connect to a coach';
 END IF;
 SELECT * INTO coach_row FROM public.rg_profiles
 WHERE coach_code = lower(trim(input_code)) AND role = 'coach';
 IF coach_row.user_id IS NULL THEN RAISE EXCEPTION 'Coach code not found'; END IF;
 INSERT INTO public.rg_coach_links(player_id, coach_id) VALUES (auth.uid(), coach_row.user_id)
 ON CONFLICT (player_id) DO UPDATE SET coach_id = excluded.coach_id, created_at = now();
 RETURN coach_row.display_name;
END $$;
REVOKE ALL ON FUNCTION public.rg_join_coach(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rg_join_coach(text) TO authenticated;

-- Тренер получает только разрешённые поля, без заметок/пульса/HRV.
CREATE OR REPLACE FUNCTION public.rg_coach_report(input_player uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.rg_profiles WHERE user_id = auth.uid() AND role = 'coach')
 OR NOT EXISTS (SELECT 1 FROM public.rg_coach_links
                WHERE coach_id = auth.uid() AND player_id = input_player) THEN
  RAISE EXCEPTION 'Report access denied';
 END IF;
 SELECT jsonb_build_object(
  'player_id', p.user_id, 'name', p.display_name,
  'context', coalesce((SELECT jsonb_build_object('level', c.level, 'goal', c.goal,
      'sessions_per_week', c.sessions_per_week, 'next_match', c.next_match)
      FROM public.rg_player_context c WHERE c.user_id = input_player), '{}'::jsonb),
  'checkins', coalesce((SELECT jsonb_agg(jsonb_build_object(
   'date', r.payload->>'date', 'sleep', r.payload->'sleep',
   'energy', r.payload->'energy', 'stress', r.payload->'stress',
   'fatigue', r.payload->'fatigue', 'discomfort', r.payload->'discomfort',
   'limitation', r.payload->'limitation', 'resting_hr', null, 'hrv', null)
   ORDER BY r.entry_key) FROM public.rg_personal_records r
   WHERE r.user_id = input_player AND r.kind = 'checkin'
     AND r.entry_key >= (current_date - 30)::text), '[]'::jsonb),
  'trainings', coalesce((SELECT jsonb_agg(jsonb_build_object(
   'date', r.payload->>'date', 'minutes', r.payload->'minutes',
   'rpe', r.payload->'rpe', 'kind', r.payload->'kind', 'focus', r.payload->'focus')
   ORDER BY r.entry_key) FROM public.rg_personal_records r
   WHERE r.user_id = input_player AND r.kind = 'training'
     AND r.payload->>'date' >= (current_date - 30)::text), '[]'::jsonb))
 INTO result FROM public.rg_profiles p WHERE p.user_id = input_player;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.rg_coach_report(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rg_coach_report(uuid) TO authenticated;

-- Связь Telegram хранится отдельно. Доступна только серверу с service_role.
CREATE TABLE IF NOT EXISTS public.rg_bot_bindings (
 coach_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 chat_id BIGINT NOT NULL UNIQUE,
 linked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rg_bot_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rg_bot_bindings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rg_bot_bindings TO service_role;
COMMIT;
