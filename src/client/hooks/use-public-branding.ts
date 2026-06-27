import { useState, useEffect } from "preact/hooks";
import { api } from "../api";
import type { Branding } from "../../shared/branding";
import {
  defaultPlatformFooterConfig,
  type PlatformFooterConfig,
  type PublicBrandingResponse,
} from "../../shared/platform-branding";

export interface PublicPageBranding {
  branding: Branding;
  platform: PlatformFooterConfig;
  timezone: string;
}

export function usePublicBranding(): PublicPageBranding | null {
  const [state, setState] = useState<PublicPageBranding | null>(null);

  useEffect(() => {
    api<PublicBrandingResponse>("GET", "/api/public/branding")
      .then((data) => {
        setState({
          branding: {
            business_name: data.business_name,
            business_tagline: data.business_tagline,
            logo_url: data.logo_url,
          },
          platform: data.platform,
          timezone: data.timezone ?? "America/St_Lucia",
        });
      })
      .catch(() => {
        setState({
          branding: { business_name: "", business_tagline: "", logo_url: "" },
          platform: defaultPlatformFooterConfig("free"),
          timezone: "America/St_Lucia",
        });
      });
  }, []);

  return state;
}
