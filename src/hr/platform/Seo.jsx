// Page title for HRMS screens. HR / employee pages are private: always noindex.
import { Helmet } from "react-helmet-async";

export default function Seo({ title, absoluteTitle, description, children }) {
  const fullTitle = absoluteTitle || (title ? `${title} | Zyllo Tech HRMS` : "Zyllo Tech HRMS");
  return (
    <Helmet>
      <title>{fullTitle}</title>
      {description && <meta name="description" content={description} />}
      <meta name="robots" content="noindex,nofollow" />
      {children}
    </Helmet>
  );
}
