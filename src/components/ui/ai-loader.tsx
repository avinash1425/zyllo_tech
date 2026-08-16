import { cn } from "@/lib/utils";

type AiLoaderProps = {
  className?: string;
  label?: string;
};

export const Component = ({ className, label = "Generating About Us" }: AiLoaderProps) => {
  return (
    <div className={cn("ai-loader-wrapper", className)}>
      <span className="ai-loader-label">{label}</span>
      <div className="ai-loader-ball" aria-hidden="true" />
    </div>
  );
};

