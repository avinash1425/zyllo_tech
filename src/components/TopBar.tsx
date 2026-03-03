import { Briefcase, LayoutDashboard, LogIn, LogOut, MapPin } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const TopBar = () => {
  const { isAuthenticated, signOut } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    signOut();
    navigate("/login");
  };

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

        {isAuthenticated ? (
          <>
            <Link to="/admin" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white transition-colors">
              <LayoutDashboard size={12} />
              Admin
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 text-white/70 hover:text-white transition-colors"
            >
              <LogOut size={12} />
              Logout
            </button>
          </>
        ) : (
          <Link to="/login" className="inline-flex items-center gap-1.5 text-white/70 hover:text-white transition-colors">
            <LogIn size={12} />
            Login
          </Link>
        )}

      </div>
    </div>
  );
};

export default TopBar;
