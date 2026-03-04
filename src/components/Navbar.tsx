import TopBar from "./TopBar";
import { Header } from "@/components/ui/header-3";

const Navbar = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <TopBar />
      <Header />
    </header>
  );
};

export default Navbar;
