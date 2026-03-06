"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { LucideIcon, Briefcase, Building2, Database, FolderKanban, BookOpen, GlobeIcon, LayersIcon, Leaf, LifeBuoy, MessageCircle, Rocket, Shield, TestTube2, UserCheck, Users, Wrench, Search } from "lucide-react";
import logo from "@/assets/zyllo-logo.png";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { MenuToggleIcon } from "@/components/ui/menu-toggle-icon";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import { HoveredLink, Menu, MenuItem, ProductItem } from "@/components/ui/navbar-menu";
import SearchDialog from "@/components/SearchDialog";

type LinkItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  description?: string;
};

const productLinks: LinkItem[] = [
  {
    title: "Web & App Development",
    href: "/services#web-engineering",
    description: "Websites, portals, and product platforms",
    icon: GlobeIcon,
  },
  {
    title: "Mobile App Development",
    href: "/services#mobile-apps",
    description: "iOS and Android app engineering",
    icon: LayersIcon,
  },
  {
    title: "Cloud Solutions & DevOps",
    href: "/services#cloud-platform",
    description: "Cloud architecture and automation",
    icon: Wrench,
  },
  {
    title: "Cybersecurity Engineering",
    href: "/services#cybersecurity",
    description: "Secure delivery and risk controls",
    icon: Shield,
  },
  {
    title: "Data Engineering & AI",
    href: "/services#data-ai",
    description: "Pipelines, ML models, and intelligent systems",
    icon: Database,
  },
  {
    title: "Quality Engineering & QA",
    href: "/services#qa-testing",
    description: "Automated testing and quality assurance",
    icon: TestTube2,
  },
  {
    title: "Dedicated Teams",
    href: "/services#dedicated-team",
    description: "Embedded engineers as your extended team",
    icon: UserCheck,
  },
  {
    title: "App Support & Maintenance",
    href: "/services#support-maintenance",
    description: "Ongoing support, SLAs, and evolution",
    icon: LifeBuoy,
  },
];

const companyLinks: LinkItem[] = [
  {
    title: "About Us",
    href: "/about",
    description: "Who we are and how we work",
    icon: Users,
  },
  {
    title: "Industries",
    href: "/industries",
    description: "Solutions by industry sector",
    icon: Building2,
  },
  {
    title: "Resources",
    href: "/resources",
    description: "Guides and implementation blueprints",
    icon: Leaf,
  },
];

const companyLinks2: LinkItem[] = [
  {
    title: "Portfolio",
    href: "/portfolio",
    description: "Case studies and client work",
    icon: FolderKanban,
  },
  {
    title: "Startups",
    href: "/startups",
    description: "Ventures built by Zyllo Tech",
    icon: Rocket,
  },
  {
    title: "Blog",
    href: "/blog",
    description: "Tech insights and guides",
    icon: BookOpen,
  },
  {
    title: "Careers",
    href: "/careers",
    description: "Join our engineering team",
    icon: Briefcase,
  },
  {
    title: "Contact Us",
    href: "/contact",
    description: "Get a free consultation",
    icon: MessageCircle,
  },
];

export function Header() {
  const [open, setOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [activeMenu, setActiveMenu] = React.useState<string | null>(null);
  const location = useLocation();

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  React.useEffect(() => {
    const openSearch = () => setSearchOpen(true);
    window.addEventListener("open-ai-search", openSearch);
    return () => window.removeEventListener("open-ai-search", openSearch);
  }, []);

  React.useEffect(() => {
    setOpen(false);
    setActiveMenu(null);
  }, [location.pathname]);

  return (
    <header
      className="sticky top-0 z-50 w-full border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/92 backdrop-blur-lg shadow-[0_8px_22px_hsl(215_24%_14%_/_0.06)]"
    >
      <nav className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
        <div className="flex items-center">
          <Link to="/" className="rounded-md p-0 focus-visible:outline-none">
            <img
              src={logo}
              alt="Zyllo Tech"
              className="h-12 w-auto max-w-none origin-left scale-[1.26] object-contain"
            />
          </Link>
          <div className="ml-5 hidden lg:flex lg:ml-8">
            <Menu setActive={setActiveMenu}>
              <MenuItem
                setActive={(item) => setActiveMenu(item)}
                active={activeMenu}
                item="Company"
                isCurrent={
                  location.pathname.startsWith("/about") ||
                  location.pathname.startsWith("/industries") ||
                  location.pathname.startsWith("/resources") ||
                  location.pathname.startsWith("/careers") ||
                  location.pathname.startsWith("/portfolio") ||
                  location.pathname.startsWith("/startups") ||
                  location.pathname.startsWith("/blog")
                }
              >
                <div className="grid w-[min(92vw,32rem)] grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className="space-y-2">
                    {companyLinks.map((item) => (
                      <ProductItem
                        key={item.title}
                        title={item.title}
                        to={item.href}
                        description={item.description || ""}
                        icon={<item.icon className="size-4" />}
                      />
                    ))}
                  </div>
                    <div className="space-y-3 rounded-xl border border-border/80 bg-muted/30 p-3">
                      {companyLinks2.map((item) => (
                        <HoveredLink
                          key={item.title}
                          to={item.href}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-background/70"
                        >
                          <item.icon className="size-4 text-primary" />
                          {item.title}
                        </HoveredLink>
                      ))}
                    </div>
                  </div>
              </MenuItem>

              <MenuItem
                setActive={(item) => setActiveMenu(item)}
                active={activeMenu}
                item="Services"
                isCurrent={location.pathname.startsWith("/services")}
              >
                <div className="w-[min(92vw,40rem)]">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {productLinks.map((item) => (
                      <ProductItem
                        key={item.title}
                        title={item.title}
                        to={item.href}
                        description={item.description || ""}
                        icon={<item.icon className="size-4" />}
                      />
                    ))}
                  </div>
                  <div className="mt-2 rounded-xl border border-border/80 bg-muted/30 p-3">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-primary">Need Custom Scope?</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Discuss your project goals and we will define a practical implementation roadmap.
                    </p>
                    <HoveredLink to="/contact" className="mt-2 inline-flex text-sm font-medium text-foreground">
                      Talk to our team →
                    </HoveredLink>
                  </div>
                </div>
              </MenuItem>

              <a
                href="/arthaai/"
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer text-sm font-medium text-foreground/90 hover:text-foreground flex items-center gap-1.5"
              >
                <Rocket className="size-3.5 text-primary" />
                ArthaAI
              </a>
            </Menu>
          </div>
        </div>
        <div className="hidden items-center gap-2 lg:flex">
          <Button variant="outline" size="icon" onClick={() => setSearchOpen(true)} aria-label="Search">
            <Search size={16} />
          </Button>
        </div>
        <Button
          size="icon"
          variant="outline"
          onClick={() => setOpen(!open)}
          className="lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label="Toggle menu"
        >
          <MenuToggleIcon open={open} className="size-5" duration={300} />
        </Button>
      </nav>
      <MobileMenu open={open} className="flex flex-col justify-between gap-2 overflow-y-auto">
        <NavigationMenu className="max-w-full">
          <div className="flex w-full flex-col gap-y-2">
            <span className="text-sm">Company</span>
            {companyLinks.map((link) => (
              <ListItem key={link.title} {...link} />
            ))}
            {companyLinks2.map((link) => (
              <ListItem key={link.title} {...link} />
            ))}
            <span className="text-sm">Services</span>
            {productLinks.map((link) => (
              <ListItem key={link.title} {...link} />
            ))}
            <span className="text-sm mt-1">Startups</span>
            <a
              href="/arthaai/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex flex-row gap-x-2 hover:bg-accent hover:text-accent-foreground rounded-sm p-2"
            >
              <div className="bg-background/40 flex aspect-square size-12 items-center justify-center rounded-md border shadow-sm">
                <Rocket className="text-foreground size-5" />
              </div>
              <div className="flex flex-col items-start justify-center">
                <span className="font-medium">ArthaAI</span>
                <span className="text-muted-foreground text-xs">Smart Money Guidance for Every Indian</span>
              </div>
            </a>
          </div>
        </NavigationMenu>
        <div className="flex flex-col gap-2">
          <Button variant="outline" className="w-full bg-transparent" onClick={() => setSearchOpen(true)}>
            Search
          </Button>
        </div>
      </MobileMenu>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
    </header>
  );
}

type MobileMenuProps = React.ComponentProps<"div"> & {
  open: boolean;
};

function MobileMenu({ open, children, className, ...props }: MobileMenuProps) {
  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div
      id="mobile-menu"
      className={cn(
        "bg-background/95 supports-[backdrop-filter]:bg-background/70 backdrop-blur-lg",
        "fixed top-14 right-0 bottom-0 left-0 z-40 flex flex-col overflow-hidden border-y lg:hidden",
      )}
    >
      <div
        data-slot={open ? "open" : "closed"}
        className={cn("data-[slot=open]:animate-in data-[slot=open]:zoom-in-97 ease-out", "size-full p-4", className)}
        {...props}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function ListItem({
  title,
  description,
  icon: Icon,
  className,
  href,
  ...props
}: React.ComponentProps<typeof NavigationMenuLink> & LinkItem) {
  return (
    <NavigationMenuLink
      className={cn(
        "w-full flex flex-row gap-x-2 data-[active=true]:focus:bg-accent data-[active=true]:hover:bg-accent data-[active=true]:bg-accent/50 data-[active=true]:text-accent-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground rounded-sm p-2",
        className,
      )}
      {...props}
      asChild
    >
      <Link to={href}>
        <div className="bg-background/40 flex aspect-square size-12 items-center justify-center rounded-md border shadow-sm">
          <Icon className="text-foreground size-5" />
        </div>
        <div className="flex flex-col items-start justify-center">
          <span className="font-medium">{title}</span>
          {description && <span className="text-muted-foreground text-xs">{description}</span>}
        </div>
      </Link>
    </NavigationMenuLink>
  );
}
