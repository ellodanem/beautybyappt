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
        });
      })
      .catch(() => {
        setState({
          branding: { business_name: "", business_tagline: "", logo_url: "" },
          platform: defaultPlatformFooterConfig("free"),
        });
      });
  }, []);

  return state;
}
