-- Let the import keep rows that need fixing, instead of skipping them:
--   * business_name may be empty (null) until someone fills it in
--   * review_notes lists what is wrong with a row ("Business Name is empty",
--     "Same as row 8 in the import"), and is cleared once the row is fixed
-- Run after 20261119010000_social_media_as_list.sql.

alter table public.advertiser_profiles
    alter column business_name drop not null;

-- Still no blank-but-not-null names: empty means null
alter table public.advertiser_profiles
    drop constraint if exists advertiser_profiles_business_name_not_blank;
alter table public.advertiser_profiles
    add constraint advertiser_profiles_business_name_not_blank
    check (business_name is null or btrim(business_name) <> '');

alter table public.advertiser_profiles
    add column if not exists review_notes text[];

comment on column public.advertiser_profiles.review_notes is
    'What needs fixing in this row (set by the import); null when nothing does.';

-- Find the rows that need review quickly
create index if not exists advertiser_profiles_needs_review_idx
    on public.advertiser_profiles (id)
    where review_notes is not null;
