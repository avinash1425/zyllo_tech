import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import SiteChrome from "./components/SiteChrome";

const Index = lazy(() => import("./pages/Index"));
const ServicesPage = lazy(() => import("./pages/ServicesPage"));
const ServiceDetailPage = lazy(() => import("./pages/ServiceDetailPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const IndustriesPage = lazy(() => import("./pages/IndustriesPage"));
const PortfolioPage = lazy(() => import("./pages/PortfolioPage"));
const BlogPage = lazy(() => import("./pages/BlogPage"));
const BlogPostPage = lazy(() => import("./pages/BlogPostPage"));
const CareersPage = lazy(() => import("./pages/CareersPage"));
const JobApplyPage = lazy(() => import("./pages/JobApplyPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazy(() => import("./pages/TermsOfServicePage"));
const SitemapPage = lazy(() => import("./pages/SitemapPage"));
const CookiePolicy = lazy(() => import("./pages/CookiePolicy"));
const Resources = lazy(() => import("./pages/Resources"));
const Startups = lazy(() => import("./pages/Startups"));
const ArthaAI = lazy(() => import("./pages/ArthaAI"));
const HyderabadPage = lazy(() => import("./pages/HyderabadPage"));
const Login = lazy(() => import("./pages/Login"));
const Signup = lazy(() => import("./pages/Signup"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
};

const App = () => (
  <HelmetProvider>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
          <SiteChrome>
            {/* Fallback must be at least viewport-height: a shorter placeholder
                lets the footer paint inside the first viewport and then jump
                down when the lazy route mounts — measured as the entire 0.32
                sitewide CLS (the footer was the sole layout-shift source). */}
            <Suspense fallback={<div className="min-h-screen" />}>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/about" element={<AboutPage />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/services/:slug" element={<ServiceDetailPage />} />
                {/* Legacy slugs from the pre-rename service catalog — 301-equivalent
                    client redirects since these still get inbound/indexed traffic. */}
                <Route path="/services/ai-ml-development" element={<Navigate to="/services/ai-solutions" replace />} />
                <Route path="/services/cloud-devops" element={<Navigate to="/services/cloud-solutions" replace />} />
                <Route path="/services/cybersecurity" element={<Navigate to="/services/cybersecurity-engineering" replace />} />
                <Route path="/services/qa-testing" element={<Navigate to="/services/quality-engineering-qa" replace />} />
                <Route path="/industries" element={<IndustriesPage />} />
                <Route path="/portfolio" element={<PortfolioPage />} />
                <Route path="/blog" element={<BlogPage />} />
                <Route path="/blog/:slug" element={<BlogPostPage />} />
                <Route path="/careers" element={<CareersPage />} />
                <Route path="/careers/:id" element={<JobApplyPage />} />
                <Route path="/contact" element={<ContactPage />} />
                {/* Short paths redirect to the canonical long form instead of
                    duplicate-rendering the same page at two URLs. */}
                <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
                <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
                <Route path="/terms" element={<Navigate to="/terms-of-service" replace />} />
                <Route path="/terms-of-service" element={<TermsOfServicePage />} />
                <Route path="/cookie-policy" element={<CookiePolicy />} />
                <Route path="/sitemap" element={<SitemapPage />} />
                <Route path="/resources" element={<Resources />} />
                <Route path="/startups" element={<Startups />} />
                <Route path="/arthaai" element={<ArthaAI />} />
                <Route path="/custom-software-development-hyderabad" element={<HyderabadPage />} />
                {/* AuthProvider (and the Supabase SDK it lazy-loads) is scoped to
                    just these four routes instead of wrapping the whole app, so
                    marketing/blog/service pages never pay for it. */}
                <Route
                  path="/login"
                  element={
                    <AuthProvider>
                      <Login />
                    </AuthProvider>
                  }
                />
                <Route
                  path="/signup"
                  element={
                    <AuthProvider>
                      <Signup />
                    </AuthProvider>
                  }
                />
                <Route
                  path="/dashboard"
                  element={
                    <AuthProvider>
                      <Dashboard />
                    </AuthProvider>
                  }
                />
                <Route
                  path="/admin"
                  element={
                    <AuthProvider>
                      <ProtectedRoute requireAdmin>
                        <AdminDashboard />
                      </ProtectedRoute>
                    </AuthProvider>
                  }
                />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </SiteChrome>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </HelmetProvider>
);

export default App;
