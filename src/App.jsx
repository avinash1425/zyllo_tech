import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import SiteChrome from "@/components/SiteChrome";
import OrganizationJsonLd from "@/components/OrganizationJsonLd";
import ScrollToTopOnRoute from "@/components/ScrollToTopOnRoute";
import PageLoader from "@/components/PageLoader";

const Home = lazy(() => import("./pages/Home.jsx"));
const About = lazy(() => import("./pages/About.jsx"));
const Services = lazy(() => import("./pages/Services.jsx"));
const ServiceDetail = lazy(() => import("./pages/ServiceDetail.jsx"));
const Industries = lazy(() => import("./pages/Industries.jsx"));
const Portfolio = lazy(() => import("./pages/Portfolio.jsx"));
const Blog = lazy(() => import("./pages/Blog.jsx"));
const BlogPost = lazy(() => import("./pages/BlogPost.jsx"));
const Careers = lazy(() => import("./pages/Careers.jsx"));
const CareerDetail = lazy(() => import("./pages/CareerDetail.jsx"));
const Contact = lazy(() => import("./pages/Contact.jsx"));
const Privacy = lazy(() => import("./pages/Privacy.jsx"));
const Terms = lazy(() => import("./pages/Terms.jsx"));
const SitemapPage = lazy(() => import("./pages/SitemapPage.jsx"));
const Login = lazy(() => import("./pages/Login.jsx"));
const NotFound = lazy(() => import("./pages/NotFound.jsx"));
const AdminRoutes = lazy(() => import("./admin/AdminRoutes.jsx"));

export default function App() {
  return (
    <>
      <OrganizationJsonLd />
      <ScrollToTopOnRoute />
      <Suspense fallback={<PageLoader />}>
        <Routes>
          {/* Admin has its own shell + auth guard (src/admin/AdminRoutes.jsx) */}
          <Route path="/admin/*" element={<AdminRoutes />} />
          <Route element={<SiteChrome />}>
            <Route path="/" element={<Home />} />
            <Route path="/about" element={<About />} />
            <Route path="/services" element={<Services />} />
            <Route path="/services/:slug" element={<ServiceDetail />} />
            <Route path="/industries" element={<Industries />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/careers" element={<Careers />} />
            <Route path="/careers/:id" element={<CareerDetail />} />
            <Route path="/contact" element={<Contact />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/sitemap" element={<SitemapPage />} />
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </>
  );
}
