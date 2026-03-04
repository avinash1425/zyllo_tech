"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "@/lib/utils";

const transition = {
  type: "spring" as const,
  mass: 0.5,
  damping: 11.5,
  stiffness: 100,
  restDelta: 0.001,
  restSpeed: 0.001,
};

export const MenuItem = ({
  setActive,
  active,
  item,
  isCurrent = false,
  children,
}: {
  setActive: (item: string) => void;
  active: string | null;
  item: string;
  isCurrent?: boolean;
  children?: React.ReactNode;
}) => {
  return (
    <div onMouseEnter={() => setActive(item)} className="relative">
      <motion.p
        transition={{ duration: 0.2 }}
        className={cn(
          "cursor-pointer text-sm font-medium text-foreground/90 hover:text-foreground",
          isCurrent && "text-primary",
        )}
      >
        {item}
      </motion.p>
      {active !== null && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={transition}
        >
          {active === item && (
            <div className="absolute left-1/2 top-[calc(100%_+_0.9rem)] -translate-x-1/2 pt-2">
              <motion.div
                transition={transition}
                layoutId="active-nav-menu"
                className="overflow-hidden rounded-2xl border border-border bg-background/95 shadow-xl backdrop-blur-md"
              >
                <motion.div layout className="h-full w-max p-4">
                  {children}
                </motion.div>
              </motion.div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
};

export const Menu = ({
  setActive,
  children,
  className,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <nav
      onMouseLeave={() => setActive(null)}
      className={cn(
        "relative flex items-center justify-center space-x-8 rounded-full border border-border/70 bg-background/75 px-8 py-2.5 shadow-sm backdrop-blur-md",
        className,
      )}
    >
      {children}
    </nav>
  );
};

export const ProductItem = ({
  title,
  description,
  to,
  icon,
}: {
  title: string;
  description: string;
  to: string;
  icon?: React.ReactNode;
}) => {
  return (
    <Link to={to} className="group flex max-w-[16rem] items-start gap-3 rounded-lg p-2 hover:bg-muted/70">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div>
        <h4 className="mb-1 text-sm font-semibold text-foreground group-hover:text-primary">{title}</h4>
        <p className="max-w-[12rem] text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </Link>
  );
};

type HoveredLinkProps = Omit<LinkProps, "className"> & {
  children: React.ReactNode;
  className?: string;
};

export const HoveredLink = ({ children, className, ...rest }: HoveredLinkProps) => {
  return (
    <Link
      {...rest}
      className={cn("text-sm text-muted-foreground transition-colors hover:text-foreground", className)}
    >
      {children}
    </Link>
  );
};

