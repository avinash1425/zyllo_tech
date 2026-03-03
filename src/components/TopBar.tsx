import { Briefcase, LogIn, MapPin } from "lucide-react";
import { Link } from "react-router-dom";

const TopBar = () => {
  return (
    <div className="bg-secondary text-white/60 text-[13px] hidden md:block">
      <div className="container mx-auto flex items-center justify-end px-4 sm:px-6 py-1.5 gap-6">
        <span className="inline-flex items-center gap-1.5 text-white/70">
          <MapPin size={12} />
          India
        </span>

        <span className="w-px h-3.5 bg-white/15" />

        <Link to="/careers" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white transition-colors">
          <Briefcase size={12} />
          Careers
        </Link>

        <span className="w-px h-3.5 bg-white/15" />

        <Link to="/login" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white transition-colors">
          <LogIn size={12} />
          Login
        </Link>

      </div>
    </div>
  );
};

export default TopBar;
