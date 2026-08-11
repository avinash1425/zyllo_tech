ALTER TABLE public.contact_submissions ALTER COLUMN subject DROP NOT NULL;
ALTER TABLE public.contact_submissions ALTER COLUMN subject SET DEFAULT NULL;