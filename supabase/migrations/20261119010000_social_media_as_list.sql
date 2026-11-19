-- Social media: one link per account instead of one text value.
-- A business can have several (Facebook, LinkedIn, Instagram, ...), e.g.
--   {https://www.facebook.com/knobleengineering1/,https://www.linkedin.com/company/knoble-engineering,...}
-- The app works out the platform from each link's address.
--
-- Existing values are split on ";", "," or whitespace, so a cell like
-- "https://a; https://b" becomes two entries.
--
-- Safe to run more than once: the column is only converted while it is still text.

alter table public.advertiser_profiles
    drop constraint if exists advertiser_profiles_social_media_is_url;

do $$
begin
    if (
        select data_type
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'advertiser_profiles'
          and column_name = 'social_media'
    ) = 'text' then
        alter table public.advertiser_profiles
            alter column social_media type text[]
            using case
                when social_media is null or btrim(social_media) = '' then null
                else array_remove(regexp_split_to_array(btrim(social_media), '[;,[:space:]]+'), '')
            end;
    end if;
end $$;

-- Every entry must be a web address, and an empty list is stored as null
alter table public.advertiser_profiles
    drop constraint if exists advertiser_profiles_social_media_are_urls;
alter table public.advertiser_profiles
    add constraint advertiser_profiles_social_media_are_urls check (
        social_media is null
        or (
            cardinality(social_media) > 0
            and array_to_string(social_media, ' ') ~* '^https?://[^[:space:]]+( https?://[^[:space:]]+)*$'
        )
    );

comment on column public.advertiser_profiles.social_media is
    'Social media links, one per account (Facebook, LinkedIn, Instagram, ...).';
