REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.increment_blog_post_views(text) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_blog_post_views(text) TO anon, service_role;