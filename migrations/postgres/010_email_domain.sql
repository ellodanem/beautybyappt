-- D3: Email domain connect (Resend DNS verification)

INSERT INTO _meta (key, value) VALUES ('email_domain', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('resend_domain_id', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_domain_status', '') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_domain_records', '[]') ON CONFLICT (key) DO NOTHING;
INSERT INTO _meta (key, value) VALUES ('email_from_address', '') ON CONFLICT (key) DO NOTHING;
