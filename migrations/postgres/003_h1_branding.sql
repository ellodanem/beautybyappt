-- H1: business branding stored in _meta (key-value settings)
INSERT INTO _meta (key, value) VALUES ('business_name', '')
ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('business_tagline', '')
ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('logo_url', '')
ON CONFLICT (key) DO NOTHING;
