-- Migration 006: Cover letter signature options

-- signature_style: 'typed' | 'script' | 'image' | 'none'
-- typed: just the full_name below a "Sincerely,"
-- script: render full_name in a cursive/script font
-- image: use uploaded PNG
-- none: no signature block
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS signature_style TEXT NOT NULL DEFAULT 'script';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS signature_image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS signature_closing TEXT NOT NULL DEFAULT 'Sincerely,';
