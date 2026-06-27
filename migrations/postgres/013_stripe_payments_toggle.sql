-- C1.1: App toggle to disable Stripe checkout even when API keys are configured

INSERT INTO _meta (key, value) VALUES ('stripe_payments_enabled', '0')
ON CONFLICT (key) DO NOTHING;
