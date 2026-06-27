import type { PlatformFooterConfig } from "../../shared/platform-branding";

export function PlatformFooter({ config }: { config: PlatformFooterConfig }) {
  if (!config.show_footer) return null;

  const marketingLinkProps = config.platform_url === "#"
    ? { href: config.platform_url, onClick: (e: Event) => e.preventDefault() }
    : { href: config.platform_url, target: "_blank", rel: "noopener noreferrer" };

  const signupLinkProps = config.signup_url === "#"
    ? { href: config.signup_url, onClick: (e: Event) => e.preventDefault() }
    : { href: config.signup_url, target: "_blank", rel: "noopener noreferrer" };

  return (
    <footer className="mt-auto border-t border-border/40 px-4 py-6 text-center">
      <p className="text-xs text-muted-foreground">
        Powered by{" "}
        <a
          {...marketingLinkProps}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {config.platform_name}
        </a>
      </p>
      {config.show_signup_promo && (
        <p className="mt-2 text-xs text-muted-foreground">
          Makeup artists —{" "}
          <a
            {...signupLinkProps}
            className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
          >
            Get your own booking page →
          </a>
        </p>
      )}
    </footer>
  );
}
