-- Advertiser profiles: one row per business, matching the advertiser spreadsheet columns
-- (Business Name, Location, Phone Number, Category, Social Media, Website).
--
-- Apply with the Supabase CLI (`supabase db push`), or paste into the Supabase SQL editor.

create table if not exists public.advertiser_profiles (
    id            uuid        primary key default gen_random_uuid(),
    business_name text        not null,
    location      text,                    -- full address, e.g. "1110 N Gaffey St, San Pedro, CA 90731, United States"
    phone_number  text,                    -- kept as text to preserve "+1 310-732-5800" formatting
    category      text,                    -- e.g. "Pizza restaurant"
    social_media  text,                    -- profile or post URL
    website       text,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    constraint advertiser_profiles_business_name_not_blank check (btrim(business_name) <> ''),
    constraint advertiser_profiles_social_media_is_url check (social_media is null or social_media ~* '^https?://'),
    constraint advertiser_profiles_website_is_url check (website is null or website ~* '^https?://')
);

comment on table public.advertiser_profiles is 'Business details for each advertiser.';

-- Search and filter by name and category (case-insensitive)
create index if not exists advertiser_profiles_business_name_idx
    on public.advertiser_profiles (lower(business_name));
create index if not exists advertiser_profiles_category_idx
    on public.advertiser_profiles (lower(category));

-- Keep updated_at current on every update
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists advertiser_profiles_set_updated_at on public.advertiser_profiles;
create trigger advertiser_profiles_set_updated_at
    before update on public.advertiser_profiles
    for each row execute function public.set_updated_at();

-- Row level security on, with no policies: the browser (publishable key) cannot read or
-- write this table directly. The BFF reaches it with the service role key, which
-- bypasses RLS. Add policies here if the client ever needs direct access.
alter table public.advertiser_profiles enable row level security;
