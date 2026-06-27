import { businessDisplayName, businessInitials, type Branding } from "../../shared/branding";

interface BusinessHeaderProps {
  branding: Pick<Branding, "business_name" | "business_tagline" | "logo_url">;
  subtitle?: string;
  size?: "sm" | "md";
  className?: string;
}

export function BusinessLogo({
  branding,
  size = "md",
}: {
  branding: Pick<Branding, "business_name" | "logo_url">;
  size?: "sm" | "md";
}) {
  const name = businessDisplayName(branding.business_name);
  const box = size === "sm" ? "h-8 w-8 text-xs" : "h-16 w-16 text-lg";
  const img = size === "sm" ? "h-8 w-8" : "h-16 w-16";

  if (branding.logo_url) {
    return <img src={branding.logo_url} alt={name} className={`${img} shrink-0 rounded-lg object-contain`} />;
  }

  return (
    <div className={`flex ${box} shrink-0 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground`}>
      {businessInitials(branding.business_name)}
    </div>
  );
}

export function BusinessHeader({ branding, subtitle, size = "md", className = "" }: BusinessHeaderProps) {
  const name = businessDisplayName(branding.business_name);
  const titleClass = size === "sm" ? "text-base font-semibold" : "text-xl font-bold tracking-tight";

  return (
    <div className={`text-center ${className}`}>
      <div className="mb-3 flex justify-center">
        <BusinessLogo branding={branding} size={size} />
      </div>
      <h1 className={titleClass}>{name}</h1>
      {branding.business_tagline && (
        <p className="mt-1 text-sm text-muted-foreground">{branding.business_tagline}</p>
      )}
      {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
