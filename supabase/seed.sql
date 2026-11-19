-- Example advertiser for local development (`supabase db reset` runs this file).
insert into public.advertiser_profiles
    (business_name, location, phone_number, category, social_media, website)
values
    (
        'Big Nick''s Pizza',
        '1110 N Gaffey St, San Pedro, CA 90731, United States',
        '+1 310-732-5800',
        'Pizza restaurant',
        array['https://www.instagram.com/p/DWpsmvdj8H4/'],
        'https://www.bignickspizza.com/'
    );
