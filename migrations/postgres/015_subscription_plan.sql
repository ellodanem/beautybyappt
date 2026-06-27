INSERT INTO _meta (key, value) VALUES ('subscription_plan', 'free')
ON CONFLICT (key) DO NOTHING;
