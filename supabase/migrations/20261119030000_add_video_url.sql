-- The advertiser's video: each row of the Final_Business_Profile list comes from one video
-- (an .webm file in the n-compass-filestack S3 bucket). Imported from a "Video URL" column.
-- Run after 20261119020000_allow_rows_needing_review.sql. Safe to run more than once.

alter table public.advertiser_profiles
    add column if not exists video_url text;

alter table public.advertiser_profiles
    drop constraint if exists advertiser_profiles_video_url_is_url;
alter table public.advertiser_profiles
    add constraint advertiser_profiles_video_url_is_url
    check (video_url is null or video_url ~* '^https?://');

comment on column public.advertiser_profiles.video_url is
    'Link to the advertiser''s video (the source of this profile).';

-- Make the API see the new column right away (otherwise: "Could not find the 'video_url'
-- column of 'advertiser_profiles' in the schema cache" until Supabase refreshes)
notify pgrst, 'reload schema';
