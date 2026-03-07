CREATE TABLE public.planner_journeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  city TEXT,
  family_members INTEGER NOT NULL DEFAULT 1,
  monthly_income NUMERIC NOT NULL DEFAULT 0,
  monthly_expenses NUMERIC NOT NULL DEFAULT 0,
  existing_corpus NUMERIC NOT NULL DEFAULT 0,
  risk_profile TEXT NOT NULL DEFAULT 'balanced',
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  goals JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  report_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.planner_journeys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own planner journey"
ON public.planner_journeys
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own planner journey"
ON public.planner_journeys
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own planner journey"
ON public.planner_journeys
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id);

CREATE TRIGGER update_planner_journeys_updated_at
BEFORE UPDATE ON public.planner_journeys
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
